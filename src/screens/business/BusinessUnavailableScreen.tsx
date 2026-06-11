import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

type BusinessUnavailableScreenProps = {
  reason?: string;
};

function resolveCopy(reason?: string): { title: string; text: string } {
  const r = (reason ?? "").trim();
  if (!r || r === "missing_active_business_org_id") {
    return {
      title: "Staveto Business nie je dostupné",
      text: "Nie ste priradený k žiadnej firme alebo aplikácia firmu ešte nenačítala. Skúste sa odhlásiť a prihlásiť znova.",
    };
  }
  if (r.startsWith("membership_not_active:pending")) {
    return {
      title: "Čaká sa na schválenie",
      text: "Vaše členstvo vo firme ešte nebolo schválené administrátorom. Po schválení sa sem dostanete automaticky.",
    };
  }
  if (r.startsWith("membership_not_active:")) {
    return {
      title: "Staveto Business nie je dostupné",
      text: "Vaše firemné členstvo nie je aktívne. Kontaktujte administrátora firmy.",
    };
  }
  if (r === "permissions_dashboard_denied" || r === "employee_use_projects") {
    return {
      title: "Ste priradený ako zamestnanec",
      text: "Správa firmy, licencie a tím sú len pre administrátorov. Vaše projekty nájdete v záložke Projekte.",
    };
  }
  if (r === "business_not_enabled") {
    return {
      title: "Licencia firmy nie je aktívna",
      text: "Firma ešte nemá aktivovanú licenciu Staveto Business. Administrátor musí dokončiť registráciu alebo platbu.",
    };
  }
  if (r === "trial_expired") {
    return {
      title: "Skúšobné obdobie skončilo",
      text: "Licencia firmy vypršala. Administrátor musí obnoviť predplatné.",
    };
  }
  if (r.startsWith("pending_payment")) {
    return {
      title: "Čaká sa na platbu",
      text: "Firma čaká na aktiváciu licencie. Administrátor musí dokončiť platbu.",
    };
  }
  return {
    title: "Staveto Business nie je dostupné",
    text: "Nemáte aktívny firemný prístup.",
  };
}

export function BusinessUnavailableScreen({ reason }: BusinessUnavailableScreenProps) {
  const copy = resolveCopy(reason);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.text}>{copy.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    color: colors.text,
    marginBottom: 10,
  },
  text: {
    fontSize: 15,
    textAlign: "center",
    color: colors.textMuted,
  },
});
