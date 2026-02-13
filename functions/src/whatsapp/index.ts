import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as crypto from "crypto";
import { normalizePhone } from "./phone";

const META_VERIFY_TOKEN = defineSecret("META_VERIFY_TOKEN");
const META_APP_SECRET = defineSecret("META_APP_SECRET");

type MediaItem = {
  storagePath: string;
  mimeType?: string;
  size?: number;
  fileName?: string;
  metaMediaId?: string;
};

function getConfig() {
  return {
    accessToken: process.env.META_ACCESS_TOKEN || "",
    graphVersion: process.env.META_GRAPH_VERSION || "v21.0",
  };
}

async function sendWhatsAppText(phoneNumberId: string, toE164: string, text: string) {
  const { accessToken, graphVersion } = getConfig();
  if (!accessToken || !phoneNumberId) return;
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toE164.replace("+", ""),
    type: "text",
    text: { body: text },
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("[whatsapp] Failed to send reply", e);
  }
}

async function downloadMetaMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType?: string; size?: number; fileName?: string }> {
  const { accessToken, graphVersion } = getConfig();
  const metaUrl = `https://graph.facebook.com/${graphVersion}/${mediaId}`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const metaJson = await metaRes.json();
  const mediaUrl = metaJson?.url as string | undefined;
  const mimeType = metaJson?.mime_type as string | undefined;
  const size = metaJson?.file_size as number | undefined;
  if (!mediaUrl) {
    throw new Error("Missing media url from Meta");
  }
  const res = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return { buffer, mimeType, size: size ?? buffer.length };
}

export const inboundWebhook = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
    invoker: "public",
    secrets: [META_VERIFY_TOKEN, META_APP_SECRET],
  },
  async (req, res) => {
    if (req.method === "GET") {
      const mode = String(req.query["hub.mode"] || "");
      const token = String(req.query["hub.verify_token"] || "");
      const challenge = String(req.query["hub.challenge"] || "");
      if (mode === "subscribe" && token && token === META_VERIFY_TOKEN.value()) {
        res.status(200).send(challenge);
        return;
      }
      res.status(403).send("Forbidden");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const sigHeader = req.header("x-hub-signature-256") || "";
    const rawBody = (req as any).rawBody;
    const bodyForHmac = rawBody
      ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody))
      : Buffer.from(JSON.stringify(req.body || {}), "utf8");
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", META_APP_SECRET.value())
        .update(bodyForHmac)
        .digest("hex");
    const ok =
      sigHeader.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sigHeader, "utf8"), Buffer.from(expected, "utf8"));
    if (!ok) {
      console.log("sigHeader", sigHeader);
      console.log("expected", expected);
      console.log("rawBodyPresent", !!rawBody);
      res.status(401).send("Invalid signature");
      return;
    }

    const payload = req.body || {};
    const entries: any[] = Array.isArray(payload.entry) ? payload.entry : [];
    if (entries.length === 0) {
      res.status(200).send("No entries");
      return;
    }

    const db = admin.firestore();
    let processedAny = false;

    try {
      for (const entry of entries) {
        const changes = Array.isArray(entry.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change.value || {};
          const messages = Array.isArray(value.messages) ? value.messages : [];
          const phoneNumberId = value?.metadata?.phone_number_id as string | undefined;
          if (messages.length === 0) {
            continue;
          }
          for (const message of messages) {
            const messageId = message?.id as string | undefined;
            const fromRaw = message?.from as string | undefined;
            const type = message?.type as string | undefined;
            if (!messageId || !fromRaw) continue;

            const fromWithPlus = fromRaw.startsWith("+") ? fromRaw : `+${fromRaw}`;
            const fromE164 = normalizePhone(fromWithPlus, "SK");
            const body = message?.text?.body || "";

            try {
              await db.collection("whatsappMessages").doc(messageId).create({
                sourceMessageId: messageId,
                from: fromE164,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            } catch {
              continue;
            }

            const suppliersSnap = await db
              .collectionGroup("suppliers")
              .where("phoneE164", "==", fromE164)
              .where("status", "==", "active")
              .get();

            const matches: { projectId: string; supplierId: string; ownerId: string; country?: string }[] = [];
            for (const doc of suppliersSnap.docs) {
              const projectId = doc.ref.parent.parent?.id;
              if (!projectId) continue;
              const projectSnap = await db.collection("projects").doc(projectId).get();
              if (!projectSnap.exists) continue;
              const projectData = projectSnap.data() as { ownerId?: string; country?: string };
              if (!projectData?.ownerId) continue;
              const userSnap = await db.collection("users").doc(projectData.ownerId).get();
              const settings = userSnap.data()?.settings as { features?: { whatsappDiary?: boolean }; country?: string } | undefined;
              if (!settings?.features?.whatsappDiary) continue;
              matches.push({
                projectId,
                supplierId: doc.id,
                ownerId: projectData.ownerId,
                country: projectData.country || settings.country,
              });
            }

            if (matches.length === 0) {
              await db.collection("whatsappInbox").doc("unmatched").collection("messages").doc(messageId).set({
                fromPhoneE164: fromE164,
                messageText: body,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                sourceMessageId: messageId,
              });
              if (phoneNumberId) {
                await sendWhatsAppText(phoneNumberId, fromE164, "Správa bola prijatá. Zatiaľ ťa nemám priradeného k projektu.");
              }
              processedAny = true;
              continue;
            }

            let target = matches[0];
            if (matches.length > 1) {
              const ctxRef = db.collection("whatsappContexts").doc(fromE164);
              const ctxSnap = await ctxRef.get();
              const now = Date.now();
              if (ctxSnap.exists) {
                const ctx = ctxSnap.data() as { projectId?: string; expiresAt?: admin.firestore.Timestamp };
                if (ctx.projectId && ctx.expiresAt && ctx.expiresAt.toMillis() > now) {
                  const found = matches.find((m) => m.projectId === ctx.projectId);
                  if (found) target = found;
                }
              }
              if (target === matches[0]) {
                await db.collection("whatsappInbox").doc("needs_project").collection("messages").doc(messageId).set({
                  fromPhoneE164: fromE164,
                  messageText: body,
                  candidateProjects: matches.map((m) => m.projectId),
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  sourceMessageId: messageId,
                });
                await ctxRef.set(
                  {
                    expiresAt: admin.firestore.Timestamp.fromMillis(now + 12 * 60 * 60 * 1000),
                  },
                  { merge: true }
                );
                if (phoneNumberId) {
                  await sendWhatsAppText(phoneNumberId, fromE164, "Prosím vyber projekt a zopakuj správu.");
                }
                processedAny = true;
                continue;
              }
            }

            const media: MediaItem[] = [];
            if (type && ["image", "video", "audio", "document"].includes(type)) {
              const mediaId = message?.[type]?.id as string | undefined;
              if (mediaId) {
                const { buffer, mimeType, size } = await downloadMetaMedia(mediaId);
                const fileName = `${type}_${mediaId}`;
                const storagePath = `projects/${target.projectId}/attachments/whatsapp_${messageId}/${fileName}`;
                await admin.storage().bucket().file(storagePath).save(buffer, { contentType: mimeType });
                media.push({ storagePath, mimeType, size, fileName, metaMediaId: mediaId });
              }
            }

            await db.collection("projects").doc(target.projectId).collection("updates").doc(messageId).set({
              projectId: target.projectId,
              supplierId: target.supplierId,
              status: "pending",
              messageText: body,
              fromPhoneE164: fromE164,
              sourceMessageId: messageId,
              media,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            await db.collection("whatsappContexts").doc(fromE164).set(
              {
                projectId: target.projectId,
                expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 12 * 60 * 60 * 1000),
              },
              { merge: true }
            );

            processedAny = true;
          }
        }
      }
    } catch (error) {
      console.error("[whatsapp] inbound error", error);
      res.status(500).send("Error");
      return;
    }

    res.status(200).send(processedAny ? "OK" : "No messages");
  }
);
