# Verantwoordingsdocument – JavaScript & Interactieve Hollow Knight Map

**Doel:** Elk criterium scoort "Goed"

---

## D1-K1-W1 – Maakt een keuze voor software

### 1. Waarom is de keuze voor JavaScript relevant?

JavaScript is gekozen omdat het de standaardtaal is voor interactieve webapplicaties — het draait in elke browser zonder installatie. Voor een project als een interactieve kaart is het de meest directe keuze: DOM-manipulatie, event handling en dynamische updates zijn kernfuncties van de taal.

**Overwogen alternatieven:**

| Taal / techniek | Waarom overwogen | Waarom niet gekozen |
|-----------------|-----------------|---------------------|
| Python | Populaire beginnarstaal | Niet geschikt voor browser-interactiviteit |
| TypeScript | Uitbreiding op JS, sterker getypeerd | Te complex als startpunt voor JS-beginners |
| React / Vue | Populaire JS-frameworks | Te hoog abstractieniveau voor het leerdoel |
| Vanilla JS | Gekozen | Geeft direct inzicht in de taal zelf, geen framework-afhankelijkheid |

Vanilla JavaScript sluit het beste aan bij het leerdoel en het project.

---

### 2. Wat is de meerwaarde van de beheersing van JavaScript?

JavaScript is de meest gebruikte programmeertaal ter wereld (Stack Overflow Developer Survey). Beheersing ervan is vrijwel verplicht voor elke webontwikkelaar. Bovendien is JavaScript met Node.js ook server-side inzetbaar, waardoor je full-stack kunt werken met één taal.

**Voorbeelden uit de beroepspraktijk:**
- Bedrijven zoals Coolblue, Booking.com en Bol.com bouwen hun interactieve webinterfaces volledig in JavaScript
- Frameworks als React, Vue en Angular — die breed gebruikt worden in de sector — bouwen voort op dezelfde JavaScript-basiskennis

**Wat dit project concreet aantoont:**
- Front-end: DOM-manipulatie, events, dynamische filters, zoekbalk
- Back-end: Node.js + Express voor een REST API met gebruikersaccounts
- Database: SQLite via better-sqlite3 voor persistente opslag van gebruikersdata

---

### 3. Ontwerp en ontwikkelplan voor het eindproduct

**Wat is het eindproduct?**  
Een volledig werkende, interactieve Hollow Knight-kaart, online gepubliceerd op cornimap.com. Gebruikers kunnen pins bekijken, zoeken, filteren op categorie en individuele items als "gevonden" markeren. Het systeem ondersteunt gebruikersaccounts met data opgeslagen in een server-side database.

**Technische architectuur:**
```
Browser (HTML / CSS / JavaScript)
    ↕ fetch() / REST API
Node.js + Express (server.js)
    ↕ better-sqlite3
SQLite-database (users.db)
    → Uitgerold op Railway
    → Eigen domein: cornimap.com
```

**Hoe toont het eindproduct de beheersing van JavaScript aan:**

| JavaScript-onderwerp | Toegepast in het project |
|----------------------|--------------------------|
| Variabelen & scope | Pinstatus, filterstatus en zoom-level bijhouden |
| Functies | `renderPins()`, `filterPins()`, `handleLogin()` |
| Arrays | Lijst van pins opslaan en filteren |
| Objects | Pindata structureren (naam, regio, coördinaten) |
| Loops | Over pins itereren om markers te renderen |
| DOM-manipulatie | Sidebar, popup en zoekresultaten dynamisch updaten |
| Events | Klik, hover, input, submit |
| Fetch + async/await | Inloggen, registreren, gevonden-status ophalen en opslaan |
| Node.js + Express | Back-end API-routes voor authenticatie en pin-status |

---

## D1-K1-W2 – Maakt zich de software eigen

### 1. Leerdoelen

**Hoofdleerdoel (SMART):**

| SMART-letter | Invulling |
|--------------|-----------|
| **S**pecifiek | JavaScript leren via freeCodeCamp t/m het onderwerp Loops, toegepast in een interactieve kaart |
| **M**eetbaar | Cursus afgerond t/m Loops; werkend eindproduct live op cornimap.com |
| **A**cceptabel | Past bij de opleiding Creative Software Development |
| **R**ealistisch | 1–2 uur per dag, 7–10 uur per week naast school |
| **T**ijdsgebonden | Cursus: 14 mei 2026 — Eindproduct: week 17 |

**Sub-leerdoelen:**
1. Variabelen, functies, arrays, objects en loops begrijpen en toepassen
2. DOM-manipulatie en event handling in een browser implementeren
3. Data ophalen en versturen via fetch() en een REST API
4. Een back-end bouwen met Node.js en Express
5. Een project online uitrollen en bereikbaar maken via een eigen domein

**Haalbaarheid aangetoond via het eindproduct:**  
Elk sub-leerdoel is aantoonbaar verwerkt in de code van cornimap.com. Het product is openbaar, live en volledig functioneel. De uitbreiding naar back-end, database en gebruikersaccounts toont dat de beheersing verder gaat dan oorspronkelijk gepland.

---

### 2. Planning en milestones

| Week | Origineel plan | Werkelijk behaald | Milestone |
|------|---------------|-------------------|-----------|
| 9–10 | freeCodeCamp | freeCodeCamp | — |
| 11 | freeCodeCamp t/m Loops | Afgerond ~14 mei | **M1: Cursus afgerond** |
| 12 | Beginnen aan map | Kaart, pins, sidebar, categoriefilters | **M2: Basiskaart werkend** |
| 13 | Werken aan product | Zoekbalk, pin-popup, hover, Show/Hide | **M3: Interactie volledig** |
| 14 | Puntenfilter op map | Gebruikersaccounts + database | **M4: Back-end live** |
| 15 | Testen + finetunen | Admin CMS, Cloudflare, Railway | **M5: Deployment gereed** |
| 16 | Extra functies / online? | Online op cornimap.com + mobiel | **M6: Product live** |
| 17 | Project afronden | Bugfixes, auth widget, sessies gedocumenteerd | **M7: Afgerond** |

**Planwijzigingen en inzichten:**
- **Week 9 — cursus gewijzigd:** Het originele plan vermeldde Udemy, maar ik volgde freeCodeCamp. Na reflectie bijgesteld, omdat freeCodeCamp beter aansluit bij mijn manier van leren (interactief, geen video's).
- **Week 14 — scope uitgebreid:** Na de basismap bleek het haalbaar om accounts en een database toe te voegen. De planning is uitgebreid, niet uitgelopen.
- **Inzicht:** Werken aan een echt project versnelt het leerproces meer dan alleen een cursus volgen.

---

### 3. Deelproducten

| Deelproduct | Wat het is | Nieuw inzicht achteraf |
|-------------|-----------|------------------------|
| Kaart + pins | Afbeelding met klikbare HTML-elementen | Positionering via percentages is schaalbaarder dan pixels |
| Sidebar + filters | Categoriefilters met Show/Hide per type | DOM-updates zijn volledig in JS te doen zonder herlaad |
| Zoekbalk | Live zoeken met groepering op regio | `.filter()` en `.includes()` zijn veel efficiënter dan handmatige loops |
| Pin-popup | Popup met naam, regio en "Mark as Found" | classList is de juiste manier om elementen te tonen/verbergen |
| Back-end (Node.js + Express) | API-routes voor auth en pin-status | JS werkt anders op de server: geen DOM, wel fs en modules |
| Gebruikersaccounts + database | SQLite via better-sqlite3, sessiecookies | Sessies moeten server-side worden beheerd, niet alleen in de browser |
| Admin CMS | Drag-and-drop herpositionering van pins | Coördinaten moeten op de server worden opgeslagen, niet in de browser |
| Mobiele ondersteuning | Pinch-to-zoom, bottom sheet popup | iOS Safari heeft afwijkend event-gedrag dat aparte oplossingen vereist |

---

### 4. Feedback verwerken

---

### 5. Reflectie op eindproduct en leertraject

**Het eindproduct — cornimap.com:**  
Het product heeft een eigen domein, een beveiligd admin-paneel (Cloudflare Zero Trust), gebruikersaccounts, een server-side database en volledige mobiele ondersteuning. Het is openbaar bereikbaar en volledig functioneel.

**Reflectie op het eindproduct:**
- De functionaliteiten gaan ver voorbij het originele plan — dat bewijst dat de basiskennis snel is omgezet in praktische toepassing
- Wat ik anders zou doen: eerder beginnen met het back-end gedeelte en meer tussendoor testen met echte gebruikers
- De mapstructuur en naamgeving in de code mogen professioneler — dit is een aandachtspunt voor een volgend project

**Reflectie op het leertraject:**
- Via freeCodeCamp heb ik de basisconcepten van JavaScript geleerd (variabelen, functies, arrays, objects, loops)
- Via het project heb ik zelfstandig geleerd: DOM-manipulatie, fetch/async-await, Node.js, Express, SQLite, deployment en domeinconfiguratie
- Ik leer sneller door te doen dan door video's te kijken — dit inzicht heeft mijn aanpak tijdens het project veranderd
- Problemen oplossen in een echt product geeft meer begrip dan losse oefeningen

**Professionaliteit:**  
Het eindproduct toont een niveau dat verder gaat dan een schoolopdracht: eigen domein, beveiligde omgeving, volledige back-end, database en mobiele ondersteuning. De code is gestructureerd met een duidelijke scheiding tussen front-end en back-end. Het project is gedocumenteerd in een SMART-plan en sessieslog.
