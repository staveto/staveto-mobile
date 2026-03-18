# Offline režim a rýchlosť aplikácie

## Čo funguje offline (bez internetu)

### ✅ Čítanie dát z cache
- **Projekty** – zoznam projektov, detaily projektu
- **Úlohy** – zoznam úloh, detaily úlohy
- **Problémy** – zoznam problémov
- **Fázy projektu** – štruktúra fáz

Dáta sa načítajú z Firestore lokálnej cache. Aby cache obsahovala dáta, musíš byť aspoň raz online a prejsť danou obrazovkou.

### ✅ Zápis (fronta)
- **Vytvorenie úlohy** – uloží sa lokálne, synchronizuje pri obnovení internetu
- **Zmena stavu úlohy** – rovnaké správanie
- **Pridanie problému** – fronta zápisov
- **Úpravy projektu** – Firestore automaticky frontuje zápisy

### ⚠️ Obmedzenia offline
- **Obrázky / prílohy** – URL z Firebase Storage sa načítajú len online
- **Prihlásenie** – vyžaduje internet
- **Cloud Functions** – napr. OCR faktúr, billing – len online
- **Notifikácie** – push notifikácie vyžadujú sieť

## Rýchlosť – čo sme optimalizovali

1. **Cache projektov** – TTL predĺžený na 5 minút (predtým 30 s)
2. **Home screen** – najprv zobrazí cache (okamžite), potom v pozadí načíta nové dáta (len keď je internet)
3. **Firestore smart read** – pri slabom signáli alebo offline sa používa cache namiesto čakania na server
4. **Offline banner** – informuje používateľa, keď je offline alebo slabý signál

## Ako získať dáta do cache pred offline použitím

1. Pripoj sa na internet
2. Otvor aplikáciu a prejdi obrazovky: Home, Projekty, konkrétny projekt
3. Firestore automaticky uloží načítané dáta do lokálnej cache
4. Pri strate internetu budeš môcť tieto dáta čítať

## Technické detaily

- **React Native Firebase** – Firestore má natívne zapnutú offline persistencie
- **firestoreSmartRead** – cache-first pri offline/poor network, server-first pri WiFi
- **NetInfo** – detekcia stavu siete (offline, cellular, wifi)
