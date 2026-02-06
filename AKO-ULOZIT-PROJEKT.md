# Ako uložiť celý projekt (aby si nič nestratil)

## 1. Git + GitHub/GitLab (najlepšie pre vývoj)

Ak ešte nemáš Git v tomto priečinku:

1. **Otvor terminál** v Cursore a prejdi do projektu:
   ```
   cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2"
   ```

2. **Inicializuj Git a prvý commit:**
   ```
   git init
   git add .
   git commit -m "Uloženie projektu Staveto – mobile, backend-worker, úpravy projektov a logo"
   ```

3. **Vytvor repozitár na GitHub** (github.com → New repository), nezaškrtávaj „Add README“.

4. **Prepoj a pošli kód nahor:**
   ```
   git remote add origin https://github.com/TVOJE_USERNAME/staveto-app.git
   git branch -M main
   git push -u origin main
   ```
   (Názov repozitára a URL si zmeň podľa svojho účtu.)

Potom pri každej zmene stačí:
```
git add .
git commit -m "Čo si zmenil"
git push
```

---

## 2. Jednoduchá záloha (kópia priečinka)

1. Zatvor Cursor.
2. V **Prehliadači súborov** choď do:
   `C:\Users\Marek\Staveto_Cursor\`
3. Klikni pravým na priečinok **`staveto-app_v2`** → **Kopírovať**.
4. Vleť niekam bezpečné, napr.:
   - `C:\Users\Marek\Zalohy\staveto-app_v2_2025-01-25`
   - alebo na druhý disk / OneDrive / Dropbox

Môžeš to opakovať napr. raz týždenne alebo pred väčšími zmenami.

---

## 3. Archiv (ZIP)

1. Pravý klik na `C:\Users\Marek\Staveto_Cursor\staveto-app_v2`.
2. **Odoslať do** → **Komprimovaný (zip) priečinok**.
3. Pomenuj napr. `staveto-app_v2-zaloha-2025-01-25.zip` a ulož na disk / do cloudu.

---

## Čo všetko projekt obsahuje (aby si vedel, že nič nechýba)

- **mobile/** – Expo/React Native appka (Projekty, úpravy, mazanie, logo, ensure-logo, …)
- **backend-worker/** – Cloudflare Worker (API, Airtable, PATCH/DELETE projektov)
- **assets/** – logo.png, icon.png (koreň projektu)
- **mobile/assets/** – assets pre mobilnú appku (logo sa sem kopíruje cez ensure-logo.js)

Odporúčanie: použi **Git + GitHub** (bod 1) ako hlavný spôsob uloženia, a občas ešte ZIP alebo kópiu priečinka (body 2 a 3) ako zálohu.
