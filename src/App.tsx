import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight,
  BookOpen, Check, ChevronDown, CircleHelp, Compass, Flower2, Leaf, MapPin,
  Moon, Navigation, RefreshCw, Settings2, ShieldCheck, Sun, TreePine, X,
} from 'lucide-react';
import { buildMission, cardinalDirection, formatDistance, type Coordinates, type Mission } from './engine';
import { anchors, pickerCells, species, speciesDisplayName, weatherOptions, type Anchor, type Language, type Species, type Weather } from './data';
import speciesImageCredits from './speciesImageCredits.json';
import { loadNaturePack, type NaturePack } from './dataPack';
import { LocationRequestError, requestDeviceLocation } from './geolocation';
import { currentForecastHour, currentForecastWeather, forecastAgeLabel, getBerlinForecast, outingWeather, type ForecastResult } from './weather';
import {
  composeLocalMission, deleteLocalModel, formatBytes, loadLocalModel, readLocalModelManifest,
  type LocalModelManifest, type ModelProgress,
} from './localModel';
import {
  templateBriefing, templateMissionComposition, type ModelMissionComposition,
} from './briefing';

type Page = 'plan' | 'mission' | 'checklist' | 'about' | 'settings';
type CheckIn = { speciesId: string; date: string };

const copy = {
  en: {
    eyebrow: 'A little field note for today', title: 'Your daily dose\nof nature.', subtitle: 'A small reason to step outside. A whole world to notice.',
    location: 'Your patch of Berlin', locate: 'Use my location', locating: 'Finding you…', change: 'Choose a nearby area', areaGridCaption: '28 approximate grid areas',
    locationSource: 'Provided by your browser · used in app memory',
    minutes: 'How long have you got?', min: 'min', weather: 'Conditions for this outing', currentWeather: 'Current Berlin forecast', start: 'Find my little adventure',
    privacy: 'Tap “Use my location” to ask Safari for a one-time location fix. The app uses it in memory and does not send or save it.',
    locationFooter: 'App code does not send or save location',
    mission: 'Your nature note', back: 'Change my plan', today: 'TODAY’S LITTLE ADVENTURE',
    head: 'A green little detour', walk: 'est. round-trip walk', observe: 'noticing', oneWay: 'straight-line, one way', nearby: 'nearby', away: 'away', route: 'Your destination',
    targets: 'Keep an eye out for', gems: 'Little treasures', fieldcraft: 'A tiny field tip',
    safety: 'A gentle safety note', conduct: 'Stay on paths, keep your distance, take nothing, and follow signs in nature reserves.',
    save: 'I spotted this', saved: 'Added to my field notes', checklist: 'Field notes', empty: 'Nothing spotted yet. The first little discovery is yours.',
    notes: 'sightings', clear: 'Clear notes', export: 'Export notes', about: 'About this little app', settings: 'Settings',
    backHome: 'Back to today', data: 'Starter nature guide · illustrative, not live sighting data',
    freshness: 'Illustrative starter guide: suggestions vary with your choices but are not based on current sightings.',
    setup: 'Offline ready', theme: 'A little note before you go', themeText: 'You do not need to know names to belong outdoors. Take your time, notice one small thing, and let the phone rest.',
    sources: 'Open data & attribution', openText: 'The app can load a Berlin pilot built from filtered public GBIF observations. Without that pack, its species guide is illustrative. The area picker and destinations remain hand-curated.',
    why: 'Why open matters', whyText: 'Offline in a park with no signal. The app code does not upload your coordinates. Swappable open-weight models. No running cost for a server.',
    known: 'Known limitations', limitationText: 'Observer bias shapes sightings; rankings summarize reports and are not calibrated probabilities or live sightings. Weather and time-of-day do not alter species ranks because this pilot has no reliable linked weather/effort data. Destinations are hand-curated, not live-verified OSM routes.',
    demoLimitationText: 'Without the GBIF pilot pack, the starter guide is illustrative and its season, time, habitat, and weather hints are heuristics—not sightings. Destinations are hand-curated, not live-verified routes.',
    outside: 'I took it outside', outsideText: 'Date: ____   Area (not exact coordinates): ____   One thing I noticed: ____   What surprised me: ____',
    language: 'Language', pace: 'Walking pace', fraction: 'Time spent walking',     model: 'Optional on-device AI experiment',
    modelText: 'Try an experimental English mission composition with SmolLM2 on this device. It is never needed: deterministic missions and translated briefings work without the model.',
    dataBacked: 'GBIF-backed ranking evidence—not calibrated presence probabilities.',
    dataLoading: 'Loading the Berlin observation pack…',
    dataError: 'The local data pack could not be validated. Showing the clearly labelled starter guide instead.',
    observationalNotice: 'Species suggestions rank filtered Berlin observations around your selected area and reachable destination, using reported observation months. They are not live sightings or probabilities.',
    observationalDisclaimer: 'Observational evidence only—not calibrated probability, abundance, or confirmation of current presence. Citizen-science reporting is uneven; weather and time-of-day are not modeled.',
    observationRecords: 'observations',
    observedMonths: 'months reported',
    nearbyObservations: 'observations in this coarse ~7 km grid cell',
    noNearbyRecords: 'No published species records met the pilot threshold in this approximate grid area. Try a nearby grid cell or a longer outing.',
    scientificNameNote: 'Common name unavailable; scientific name shown',
    nameLanguageLabels: { en: 'English common name', de: 'German common name', fr: 'French common name' },
    nearbyEvidenceNote: 'Each suggested species has records in the approximate grid cell around your start—not necessarily at this exact spot or today.',
    sourceLink: 'GBIF dataset and citation',
    ready: 'Works offline after first load', noGps: 'This browser does not provide location. Choose an area below.',
    insecureLocation: 'Location only works on a secure HTTPS page (or localhost). Open the site’s HTTPS address, then try again.',
    locationDenied: 'Location permission is blocked. Use the site controls beside the address bar, set Location to Allow, then reload this page.',
    permissionSteps: 'If Safari did not show a prompt, it may remember an earlier choice. On Mac: Safari → Settings → Websites → Location, set this site to Ask or Allow. On iPhone/iPad: tap the page menu (aA) → Website Settings → Location, set it to Ask or Allow. Also make sure Settings → Privacy & Security → Location Services is on, then return here and try again.',
    locationServicesHelp: 'Safari permission is already allowed, but the device did not provide a fix. Mac: System Settings → Privacy & Security → Location Services; turn it on and allow Safari. iPhone/iPad: Settings → Privacy & Security → Location Services → Safari Websites; choose While Using and enable Precise Location if shown. Then try again; the app waits up to about a minute.',
    chromeHelp: 'Chrome help', firefoxHelp: 'Firefox help', safariHelp: 'Safari on Mac help', appleLocationHelp: 'iPhone/iPad Location Services',
    locationUnavailable: 'Your browser allowed the request but could not get a location. Turn on your device’s Location Services, then try again; you can also choose an area below.',
    locationTimeout: 'The browser permission is allowed, but the device did not return a location in time. Check system Location Services and try again, or choose an area below.',
    locationSuccess: 'Approximate browser location received and used in app memory.',
    outsideBerlin: 'That looks outside Berlin. I’ve moved the start to the nearest public green path.',
    inaccurate: 'Safari returned a location too imprecise to place within Berlin. Turn on Precise Location if available, or choose an area below.',
    noLocation: 'Could not read your location. Choose an area below.',
    storageError: 'Could not read or save your field notes on this device.',
    offlineCheckError: 'The offline cache could not be checked. Keep this page open while it finishes loading.',
    weatherLoading: 'Checking Berlin weather…',
    weatherError: 'Live weather is unavailable. Choose conditions for your outing below.',
    retryWeather: 'Retry weather',
    weatherLive: 'Fixed Berlin forecast',
    weatherCached: 'Berlin forecast saved on this phone',
    weatherStale: 'Saved forecast is over 3 hours old. Choose current conditions.',
    weatherUnavailable: 'No forecast available. Choose current conditions.',
    weatherFreshness: 'Updated',
    briefing: 'A little pocket-sized briefing',
    objective: 'Your mission objective',
    observations: 'Notice along the way',
    alternative: 'If you do not find it',
    putAway: 'Put your phone away between steps; no sighting is guaranteed.',
    template: 'Handcrafted mission · AI not used',
    modelWorking: 'Generating with on-device AI…',
    modelUsed: 'Generated with on-device AI',
    modelFallback: 'Handcrafted mission remains · AI experiment unavailable',
    tryModel: 'Try optional AI mission (about 200 MB on first use)',
    retryModel: 'Try another AI composition',
    prepareModel: 'Download model on this device',
    deleteModel: 'Delete downloaded model',
    modelAdvice: 'The optional model downloads about 200 MB only when you choose to try an AI mission. It then runs locally on a compatible device. Your browser may clear the cached model. Wi-Fi recommended.',
    modelUnavailable: 'SmolLM2-360M-Instruct · Apache-2.0',
    modelLoaded: 'Model ready on this device',
    conditions: { dry_sunny: 'Sunny', dry_overcast: 'Overcast', light_rain: 'Drizzle', heavy_rain: 'Heavy rain', snow_frost_ice: 'Frost / ice', thunderstorm: 'Thunderstorm' },
    groups: { Bird: 'Bird', Plant: 'Plant', Mammal: 'Mammal', Invertebrate: 'Invertebrate', Fungi: 'Fungi', Herpetofauna: 'Reptile / amphibian', Other: 'Other wildlife' },
    todayDate: 'Built for this moment', point: 'little green start', outdoors: 'Go gently. Look closely.',
    activity: 'Illustrative season', band: 'Observation-based picks', for: 'for your patch',
  },
  de: {
    eyebrow: 'Eine kleine Notiz für heute', title: 'Deine tägliche\nDosis Natur.', subtitle: 'Ein kleiner Grund rauszugehen. Eine ganze Welt zum Entdecken.',
    location: 'Dein Stück Berlin', locate: 'Meinen Standort nutzen', locating: 'Standort wird gesucht…', change: 'Gebiet in der Nähe wählen', areaGridCaption: '28 ungefähre Bereiche',
    locationSource: 'Vom Browser bereitgestellt · in der App im Arbeitsspeicher genutzt',
    minutes: 'Wie viel Zeit hast du?', min: 'Min.', weather: 'Bedingungen für deinen Ausflug', currentWeather: 'Aktuelle Berliner Vorhersage', start: 'Mein kleines Abenteuer finden',
    privacy: 'Tippe auf „Meinen Standort nutzen“, um Safari einmalig nach deinem Standort zu fragen. Die App nutzt ihn im Arbeitsspeicher und sendet oder speichert ihn nicht.',
    locationFooter: 'Die App sendet oder speichert den Standort nicht',
    mission: 'Deine Natur-Notiz', back: 'Plan ändern', today: 'DEIN KLEINES ABENTEUER',
    head: 'Ein grüner kleiner Umweg', walk: 'geschätzter Hin- und Rückweg', observe: 'Entdecken', oneWay: 'Luftlinie, einfache Strecke', nearby: 'in der Nähe', away: 'entfernt', route: 'Dein Ziel',
    targets: 'Halte Ausschau nach', gems: 'Kleine Schätze', fieldcraft: 'Ein kleiner Beobachtungstipp',
    safety: 'Ein sanfter Sicherheitshinweis', conduct: 'Bleib auf den Wegen, halte Abstand, nimm nichts mit und beachte die Schilder im Naturschutzgebiet.',
    save: 'Habe ich entdeckt', saved: 'In deinen Notizen gespeichert', checklist: 'Natur-Notizen', empty: 'Noch nichts entdeckt. Die erste kleine Entdeckung wartet auf dich.',
    notes: 'Funde', clear: 'Notizen löschen', export: 'Notizen exportieren', about: 'Über diese kleine App', settings: 'Einstellungen',
    backHome: 'Zurück zu heute', data: 'Natur-Startguide · beispielhaft, keine aktuellen Funddaten',
    freshness: 'Beispielhafter Startguide: Tipps ändern sich mit deiner Auswahl, beruhen aber nicht auf aktuellen Funden.',
    setup: 'Offline bereit', theme: 'Eine kleine Notiz, bevor du losgehst', themeText: 'Du musst keine Namen kennen, um draußen dazuzugehören. Lass dir Zeit, entdecke eine Kleinigkeit und leg das Handy weg.',
    sources: 'Offene Daten & Quellen', openText: 'Die App kann einen Berlin-Piloten aus gefilterten öffentlichen GBIF-Beobachtungen laden. Ohne dieses Paket ist der Arten-Guide beispielhaft. Gebietsauswahl und Ziele bleiben handgepflegt.',
    why: 'Warum offene Daten wichtig sind', whyText: 'Offline im Park ohne Empfang. Der App-Code lädt deine Koordinaten nicht hoch. Austauschbare Open-Weight-Modelle. Keine laufenden Serverkosten.',
    known: 'Bekannte Einschränkungen', limitationText: 'Beobachtungs-Bias prägt Funddaten; die Rangfolge fasst Meldungen zusammen und ist weder kalibrierte Wahrscheinlichkeit noch aktueller Nachweis. Wetter und Tageszeit verändern die Rangfolge nicht, da verknüpfte Wetter- und Beobachtungsaufwandsdaten fehlen. Ziele sind handgepflegt, keine live geprüften OSM-Routen.',
    demoLimitationText: 'Ohne GBIF-Pilotpaket ist der Startguide beispielhaft; Saison-, Tageszeit-, Habitat- und Wetterhinweise sind Heuristiken, keine Funde. Ziele sind handgepflegt und nicht live als Routen geprüft.',
    outside: 'Ich war draußen', outsideText: 'Datum: ____   Gebiet (keine genauen Koordinaten): ____   Eine Entdeckung: ____   Das hat mich überrascht: ____',
    language: 'Sprache', pace: 'Gehgeschwindigkeit', fraction: 'Zeit zu Fuß',     model: 'Optionales lokales KI-Experiment',
    modelText: 'Teste eine experimentelle englische Missionskomposition mit SmolLM2 auf diesem Gerät. Sie ist nicht erforderlich: Deterministische Missionen und übersetzte Notizen funktionieren ohne Modell.',
    dataBacked: 'GBIF-gestützte Rangfolge – keine kalibrierten Präsenzwahrscheinlichkeiten.',
    dataLoading: 'Berlin-Beobachtungspaket wird geladen…',
    dataError: 'Das lokale Datenpaket konnte nicht geprüft werden. Stattdessen wird der klar gekennzeichnete Startguide angezeigt.',
    observationalNotice: 'Arten werden nach gefilterten Berliner Beobachtungen im gewählten Gebiet und erreichbaren Ziel sowie gemeldeten Monaten sortiert. Keine aktuellen Funde oder Wahrscheinlichkeiten.',
    observationalDisclaimer: 'Nur Beobachtungshinweise – keine kalibrierte Wahrscheinlichkeit, Häufigkeit oder Bestätigung des aktuellen Vorkommens. Citizen-Science-Meldungen sind ungleich verteilt; Wetter und Tageszeit fließen nicht ein.',
    observationRecords: 'Beobachtungen',
    observedMonths: 'Monate gemeldet',
    nearbyObservations: 'Beobachtungen in dieser groben Rasterzelle (~7 km)',
    noNearbyRecords: 'In diesem ungefähren Rastergebiet gibt es keine veröffentlichten Artnachweise, die den Schwellenwert des Piloten erfüllen. Probiere ein benachbartes Gebiet oder einen längeren Ausflug.',
    scientificNameNote: 'Kein Trivialname verfügbar; wissenschaftlicher Name angezeigt',
    nameLanguageLabels: { en: 'Englischer Trivialname', de: 'Deutscher Trivialname', fr: 'Französischer Trivialname' },
    nearbyEvidenceNote: 'Für jede vorgeschlagene Art gibt es Meldungen in der ungefähren Rasterzelle um deinen Start – nicht zwingend genau an diesem Ort oder heute.',
    sourceLink: 'GBIF-Datensatz und Zitat',
    ready: 'Nach dem ersten Laden offline nutzbar', noGps: 'Dieser Browser stellt keinen Standort bereit. Wähle unten ein Gebiet.',
    insecureLocation: 'Der Standort funktioniert nur über eine sichere HTTPS-Seite (oder localhost). Öffne die HTTPS-Adresse und versuche es erneut.',
    locationDenied: 'Die Standortfreigabe ist blockiert. Öffne die Website-Einstellungen neben der Adressleiste, erlaube den Standort und lade diese Seite neu.',
    permissionSteps: 'Wenn Safari keinen Dialog gezeigt hat, ist vielleicht eine frühere Auswahl gespeichert. Mac: Safari → Einstellungen → Websites → Standort und für diese Website „Fragen“ oder „Erlauben“ wählen. iPhone/iPad: Seitenmenü (aA) → Website-Einstellungen → Standort und „Fragen“ oder „Erlauben“ wählen. Aktiviere außerdem Einstellungen → Datenschutz & Sicherheit → Ortungsdienste und versuche es erneut.',
    locationServicesHelp: 'Die Safari-Freigabe ist bereits erteilt, aber das Gerät hat keine Position geliefert. Mac: Systemeinstellungen → Datenschutz & Sicherheit → Ortungsdienste aktivieren und Safari erlauben. iPhone/iPad: Einstellungen → Datenschutz & Sicherheit → Ortungsdienste → Safari-Websites; „Beim Verwenden“ wählen und, falls angezeigt, „Genauer Standort“ aktivieren. Danach erneut versuchen; die App wartet bis zu etwa einer Minute.',
    chromeHelp: 'Chrome-Hilfe', firefoxHelp: 'Firefox-Hilfe', safariHelp: 'Safari-Hilfe (Mac)', appleLocationHelp: 'Ortungsdienste auf iPhone/iPad',
    locationUnavailable: 'Der Browser durfte den Standort abrufen, konnte ihn aber nicht bestimmen. Aktiviere die Ortungsdienste des Geräts und versuche es erneut oder wähle unten ein Gebiet.',
    locationTimeout: 'Der Browser durfte zugreifen, aber das Gerät hat nicht rechtzeitig einen Standort geliefert. Prüfe die System-Ortungsdienste und versuche es erneut oder wähle ein Gebiet.',
    locationSuccess: 'Ungefährer Browser-Standort empfangen und im Arbeitsspeicher der App genutzt.',
    outsideBerlin: 'Das scheint außerhalb Berlins zu sein. Der Startpunkt wurde zum nächsten öffentlichen Grünweg verschoben.',
    inaccurate: 'Safari hat einen zu ungenauen Standort für Berlin geliefert. Aktiviere, falls verfügbar, den genauen Standort oder wähle unten ein Gebiet.',
    noLocation: 'Standort konnte nicht gelesen werden. Wähle unten ein Gebiet.',
    storageError: 'Deine Natur-Notizen konnten auf diesem Gerät nicht gelesen oder gespeichert werden.',
    offlineCheckError: 'Der Offline-Cache konnte nicht geprüft werden. Lass die Seite geöffnet, bis sie fertig geladen ist.',
    weatherLoading: 'Berliner Wetter wird abgerufen…',
    weatherError: 'Live-Wetter nicht verfügbar. Wähle unten die Bedingungen für deinen Ausflug.',
    retryWeather: 'Wetter erneut laden',
    weatherLive: 'Berliner Wettervorhersage',
    weatherCached: 'Berliner Wettervorhersage auf diesem Gerät gespeichert',
    weatherStale: 'Vorhersage älter als 3 Stunden. Wähle die aktuellen Bedingungen.',
    weatherUnavailable: 'Keine Vorhersage verfügbar. Wähle die aktuellen Bedingungen.',
    weatherFreshness: 'Aktualisiert',
    briefing: 'Eine kleine Notiz für unterwegs',
    objective: 'Dein Beobachtungsziel',
    observations: 'Entdecke unterwegs',
    alternative: 'Falls du es nicht entdeckst',
    putAway: 'Steck dein Handy zwischen den Schritten weg; Sichtungen sind nicht garantiert.',
    template: 'Handgeplante Mission · keine KI verwendet',
    modelWorking: 'Generierung mit lokaler KI…',
    modelUsed: 'Mit lokaler KI generiert',
    modelFallback: 'Handgeplante Mission bleibt · KI-Experiment nicht verfügbar',
    tryModel: 'Optionales KI-Experiment testen (erstmals ca. 200 MB)',
    retryModel: 'Andere KI-Komposition testen',
    prepareModel: 'Modell auf dieses Gerät laden',
    deleteModel: 'Geladenes Modell löschen',
    modelAdvice: 'Das optionale Modell lädt etwa 200 MB nur, wenn du eine KI-Mission ausprobieren möchtest. Danach läuft es auf einem kompatiblen Gerät lokal. Der Browser kann den Modell-Cache löschen. WLAN empfohlen.',
    modelUnavailable: 'SmolLM2-360M-Instruct · Apache-2.0',
    modelLoaded: 'Modell auf diesem Gerät bereit',
    conditions: { dry_sunny: 'Sonnig', dry_overcast: 'Bewölkt', light_rain: 'Nieselregen', heavy_rain: 'Starker Regen', snow_frost_ice: 'Frost / Eis', thunderstorm: 'Gewitter' },
    groups: { Bird: 'Vogel', Plant: 'Pflanze', Mammal: 'Säugetier', Invertebrate: 'Wirbellose', Fungi: 'Pilz', Herpetofauna: 'Reptil / Amphibium', Other: 'Sonstige Tierwelt' },
    todayDate: 'Für diesen Moment', point: 'kleiner grüner Start', outdoors: 'Geh sanft. Schau genau hin.',
    activity: 'Beispielhafte Saison', band: 'Beobachtungsbasierte Tipps', for: 'in deiner Nähe',
  },
  fr: {
    eyebrow: 'Une petite note de terrain pour aujourd’hui', title: 'Ta dose quotidienne\nde nature.', subtitle: 'Une petite raison de sortir. Tout un monde à remarquer.',
    location: 'Ton coin de Berlin', locate: 'Utiliser ma position', locating: 'Je te cherche…', change: 'Choisir un quartier proche', areaGridCaption: '28 zones approximatives',
    locationSource: 'Fournie par le navigateur · utilisée en mémoire par l’appli',
    minutes: 'Tu as combien de temps ?', min: 'min', weather: 'Conditions pour cette sortie', currentWeather: 'Prévisions actuelles à Berlin', start: 'Trouver ma petite aventure',
    privacy: 'Appuie sur « Utiliser ma position » pour demander à Safari une position ponctuelle. L’appli l’utilise en mémoire et ne l’envoie ni ne l’enregistre.',
    locationFooter: 'L’appli n’envoie ni n’enregistre ta position',
    mission: 'Ta note nature', back: 'Modifier mon programme', today: 'TA PETITE AVENTURE DU JOUR',
    head: 'Un petit détour tout vert', walk: 'aller-retour estimé à pied', observe: 'observation', oneWay: 'à vol d’oiseau, aller simple', nearby: 'à proximité', away: 'à pied', route: 'Ta destination',
    targets: 'Ouvre l’œil pour', gems: 'Petits trésors', fieldcraft: 'Un mini-conseil de terrain',
    safety: 'Un petit rappel de sécurité', conduct: 'Reste sur les sentiers, garde tes distances, ne prends rien et respecte les panneaux des réserves.',
    save: 'Je l’ai aperçu', saved: 'Ajouté à tes notes', checklist: 'Notes de terrain', empty: 'Rien aperçu pour le moment. Ta première découverte t’attend.',
    notes: 'observations', clear: 'Effacer les notes', export: 'Exporter les notes', about: 'À propos de cette appli', settings: 'Réglages',
    backHome: 'Retour à aujourd’hui', data: 'Guide nature de départ · illustratif, pas des observations récentes',
    freshness: 'Guide illustratif : les suggestions varient selon tes choix, sans données d’observations récentes.',
    setup: 'Prêt hors ligne', theme: 'Un petit mot avant de partir', themeText: 'Pas besoin de connaître les noms pour avoir ta place dehors. Prends ton temps, remarque un détail et range ton téléphone.',
    sources: 'Données ouvertes & attribution', openText: 'L’appli peut charger un pilote berlinois basé sur des observations GBIF publiques filtrées. Sans ce pack, le guide des espèces est illustratif. Les quartiers et destinations restent définis à la main.',
    why: 'Pourquoi l’ouverture compte', whyText: 'Hors ligne dans un parc sans réseau. Le code de l’appli n’envoie pas tes coordonnées. Modèles ouverts interchangeables. Aucun coût de serveur.',
    known: 'Limites connues', limitationText: 'Les biais influencent les observations ; le classement résume des signalements, pas des probabilités calibrées ni des présences actuelles. La météo et l’heure ne modifient pas le classement, faute de données fiables liées à l’effort et à la météo. Les destinations sont définies à la main, pas vérifiées comme itinéraires OSM.',
    demoLimitationText: 'Sans le pack pilote GBIF, le guide est illustratif : saison, heure, habitat et météo sont des heuristiques, pas des observations. Les destinations sont définies à la main et non vérifiées comme itinéraires.',
    outside: 'Je l’ai emmenée dehors', outsideText: 'Date : ____   Quartier (pas de coordonnées précises) : ____   Une chose remarquée : ____   Ce qui m’a surpris : ____',
    language: 'Langue', pace: 'Allure de marche', fraction: 'Temps de marche',     model: 'Expérience IA locale facultative',
    modelText: 'Teste une composition expérimentale de mission en anglais avec SmolLM2 sur cet appareil. Elle n’est pas nécessaire : les missions déterministes et les notes traduites fonctionnent sans modèle.',
    dataBacked: 'Classement fondé sur GBIF — pas des probabilités de présence calibrées.',
    dataLoading: 'Chargement du pack d’observations de Berlin…',
    dataError: 'Le pack local n’a pas pu être validé. Le guide de départ clairement signalé est affiché à la place.',
    observationalNotice: 'Les espèces sont classées selon les observations filtrées autour du quartier et de la destination accessibles, ainsi que les mois signalés. Ni observations en direct ni probabilités.',
    observationalDisclaimer: 'Indices issus d’observations uniquement — sans probabilité calibrée, abondance ni confirmation de présence actuelle. Les observations participatives sont inégales ; météo et heure ne sont pas modélisées.',
    observationRecords: 'observations',
    observedMonths: 'mois signalés',
    nearbyObservations: 'observations dans cette maille grossière (~7 km)',
    noNearbyRecords: 'Aucune espèce publiée ne répond au seuil du pilote dans cette zone approximative. Essaie une zone voisine ou une sortie plus longue.',
    scientificNameNote: 'Nom courant indisponible ; nom scientifique affiché',
    nameLanguageLabels: { en: 'Nom courant anglais', de: 'Nom courant allemand', fr: 'Nom courant français' },
    nearbyEvidenceNote: 'Chaque espèce proposée a des signalements dans la maille approximative autour du départ, pas nécessairement à cet endroit précis ni aujourd’hui.',
    sourceLink: 'Jeu de données et citation GBIF',
    ready: 'Fonctionne hors ligne après le premier chargement', noGps: 'Ce navigateur ne fournit pas la position. Choisis un quartier ci-dessous.',
    insecureLocation: 'La position fonctionne uniquement sur une page HTTPS sécurisée (ou localhost). Ouvre l’adresse HTTPS du site puis réessaie.',
    locationDenied: 'La permission de localisation est bloquée. Dans les contrôles du site près de la barre d’adresse, autorise la position puis recharge cette page.',
    permissionSteps: 'Si Safari n’a pas affiché de demande, un ancien choix est peut-être mémorisé. Mac : Safari → Réglages → Sites web → Position, puis règle ce site sur Demander ou Autoriser. iPhone/iPad : menu de page (aA) → Réglages du site web → Position, puis Demander ou Autoriser. Vérifie aussi que Réglages → Confidentialité et sécurité → Service de localisation est activé.',
    locationServicesHelp: 'Safari a déjà l’autorisation, mais l’appareil n’a pas fourni de position. Mac : Réglages Système → Confidentialité et sécurité → Service de localisation ; active-le et autorise Safari. iPhone/iPad : Réglages → Confidentialité et sécurité → Service de localisation → Sites web Safari ; choisis « Lorsque l’app est active » et active « Position exacte » si proposé. Réessaie ensuite ; l’appli attend jusqu’à environ une minute.',
    chromeHelp: 'Aide Chrome', firefoxHelp: 'Aide Firefox', safariHelp: 'Aide Safari sur Mac', appleLocationHelp: 'Service de localisation iPhone/iPad',
    locationUnavailable: 'Le navigateur a autorisé la demande, mais n’a pas trouvé ta position. Active les services de localisation de ton appareil, puis réessaie ou choisis une zone ci-dessous.',
    locationTimeout: 'Le navigateur était autorisé, mais l’appareil n’a pas fourni de position à temps. Vérifie les services système, puis réessaie ou choisis une zone.',
    locationSuccess: 'Position approximative reçue du navigateur et utilisée en mémoire par l’appli.',
    outsideBerlin: 'Cela semble hors de Berlin. Le départ a été déplacé au chemin vert public le plus proche.',
    inaccurate: 'Safari a fourni une position trop imprécise pour Berlin. Active la position exacte si possible, ou choisis un quartier ci-dessous.',
    noLocation: 'Position introuvable. Choisis un quartier ci-dessous.',
    storageError: 'Impossible de lire ou d’enregistrer tes notes sur cet appareil.',
    offlineCheckError: 'Le cache hors ligne n’a pas pu être vérifié. Garde cette page ouverte pendant le chargement.',
    weatherLoading: 'Consultation de la météo de Berlin…',
    weatherError: 'Météo en direct indisponible. Choisis les conditions de ta sortie ci-dessous.',
    retryWeather: 'Réessayer la météo',
    weatherLive: 'Prévision météo fixe de Berlin',
    weatherCached: 'Prévision de Berlin enregistrée sur ce téléphone',
    weatherStale: 'Prévision enregistrée depuis plus de 3 h. Choisis les conditions actuelles.',
    weatherUnavailable: 'Aucune prévision disponible. Choisis les conditions actuelles.',
    weatherFreshness: 'Mise à jour',
    briefing: 'Une petite note à emporter',
    objective: 'Ton objectif',
    observations: 'À observer en chemin',
    alternative: 'Si tu ne le trouves pas',
    putAway: 'Range ton téléphone entre les étapes ; aucune observation n’est garantie.',
    template: 'Mission préparée à la main · aucune IA utilisée',
    modelWorking: 'Génération avec l’IA sur l’appareil…',
    modelUsed: 'Généré avec l’IA sur l’appareil',
    modelFallback: 'La mission artisanale reste affichée · expérience IA indisponible',
    tryModel: 'Tester l’IA facultative (environ 200 Mo la première fois)',
    retryModel: 'Tester une autre composition IA',
    prepareModel: 'Télécharger le modèle sur cet appareil',
    deleteModel: 'Supprimer le modèle téléchargé',
    modelAdvice: 'Le modèle facultatif télécharge environ 200 Mo uniquement si tu choisis de tester une mission IA. Il fonctionne ensuite localement sur un appareil compatible. Le navigateur peut effacer son cache. Wi-Fi conseillé.',
    modelUnavailable: 'SmolLM2-360M-Instruct · Apache-2.0',
    modelLoaded: 'Modèle prêt sur cet appareil',
    conditions: { dry_sunny: 'Ensoleillé', dry_overcast: 'Couvert', light_rain: 'Bruine', heavy_rain: 'Forte pluie', snow_frost_ice: 'Gel / verglas', thunderstorm: 'Orage' },
    groups: { Bird: 'Oiseau', Plant: 'Plante', Mammal: 'Mammifère', Invertebrate: 'Invertébré', Fungi: 'Champignon', Herpetofauna: 'Reptile / amphibien', Other: 'Autre faune' },
    todayDate: 'Préparé pour cet instant', point: 'petit départ vert', outdoors: 'Doucement. Ouvre l’œil.',
    activity: 'Saison illustrative', band: 'Idées basées sur les observations', for: 'près de chez toi',
  },
} as const;

function loadNotes(): CheckIn[] {
  const raw = localStorage.getItem('nature-checklist');
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid field notes');
  const isCheckIn = (item: unknown): item is CheckIn =>
    typeof item === 'object' && item !== null &&
    'speciesId' in item && typeof item.speciesId === 'string' &&
    'date' in item && typeof item.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    /^[a-z0-9-]+$/.test(item.speciesId);
  if (!parsed.every(isCheckIn)) throw new Error('Invalid field notes');
  return parsed;
}

function localDateStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function photoCreditFor(item: Species) {
  return item.scientific_name
    ? speciesImageCredits[item.scientific_name as keyof typeof speciesImageCredits]
    : undefined;
}

function SpeciesArt({ item, small = false }: { item: Species; small?: boolean }) {
  const image = photoCreditFor(item);
  return (
    <div className={`species-art ${small ? 'species-art--small' : ''}`} aria-label={speciesDisplayName(item, 'en').name} role="img">
      <span className="art-sun" />
      <span className="art-emoji" aria-hidden="true">{item.emoji}</span>
      <span className="art-grass grass-one" />
      <span className="art-grass grass-two" />
      {image && <img className="species-photo" src={image.image} alt="" loading="lazy" decoding="async" onError={(event) => event.currentTarget.remove()} />}
    </div>
  );
}

function getDefaultArea() {
  const area = pickerCells.find((cell) => cell.id === 'area-3-3');
  if (!area) throw new Error('The default Berlin area is missing from the area grid.');
  return area;
}

function App() {
  const defaultArea = getDefaultArea();
  const [language, setLanguage] = useState<Language>('en');
  const t = copy[language];
  const [page, setPage] = useState<Page>('plan');
  const [minutes, setMinutes] = useState(40);
  const [weather, setWeather] = useState<Weather>('dry_sunny');
  const [manualWeather, setManualWeather] = useState<Weather | null>(null);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'loading' | 'error' | 'live' | 'cached' | 'stale'>('loading');
  const [weatherErrorDetail, setWeatherErrorDetail] = useState('');
  const [location, setLocation] = useState<Coordinates>({ lat: defaultArea.lat, lng: defaultArea.lng });
  const [selectedArea, setSelectedArea] = useState(defaultArea.id);
  const [locationLabel, setLocationLabel] = useState(defaultArea.name);
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const [naturePack, setNaturePack] = useState<NaturePack | null>(null);
  const [dataPackStatus, setDataPackStatus] = useState<'loading' | 'demo' | 'ready' | 'error'>('loading');
  const [dataPackError, setDataPackError] = useState('');
  const [mission, setMission] = useState<Mission | null>(null);
  const [briefing, setBriefing] = useState('');
  const [modelComposition, setModelComposition] = useState<ModelMissionComposition | null>(null);
  const [modelManifest, setModelManifest] = useState<LocalModelManifest | null>(null);
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState('');
  const [modelUsed, setModelUsed] = useState(false);
  const modelGeneration = useRef(0);
  const [notes, setNotes] = useState<CheckIn[]>([]);
  const [pace, setPace] = useState(75);
  const [walkFraction, setWalkFraction] = useState(0.6);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  const direction = useMemo(() => mission && mission.distanceKm > 0 ? cardinalDirection(mission.bearing, language) : '', [mission, language]);
  const codeOfConduct = t.conduct;
  const displaySpecies = naturePack?.species ?? species;
  const today = localDateStamp();
  const outingConditions = outingWeather(forecast, new Date(), minutes);
  const currentHour = currentForecastHour(forecast);
  const currentWeather = currentForecastWeather(forecast);
  const missionWeather = manualWeather ?? (outingConditions.hasForecast
    ? outingConditions.thunderstorm ? 'thunderstorm' : outingConditions.bucket
    : weather);

  async function refreshWeather(isActive: () => boolean = () => true) {
    if (isActive()) {
      setWeatherStatus('loading');
      setWeatherErrorDetail('');
    }
    try {
      const latest = await getBerlinForecast();
      if (!isActive()) return;
      setForecast(latest);
      setWeatherStatus(latest.source);
      setWeatherErrorDetail(latest.cacheWarning ? `Forecast works, but could not be saved offline: ${latest.cacheWarning}` : '');
    } catch (error) {
      if (!isActive()) return;
      setWeatherStatus('error');
      setWeatherErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    let active = true;
    const refreshWhenOnline = () => void refreshWeather(() => active);
    refreshWhenOnline();
    window.addEventListener('online', refreshWhenOnline);
    void loadNaturePack().then((pack) => {
      if (!active) return;
      setNaturePack(pack);
      setDataPackStatus(pack ? 'ready' : 'demo');
    }).catch((error: unknown) => {
      if (!active) return;
      setDataPackStatus('error');
      setDataPackError(error instanceof Error ? error.message : 'Unknown local pack validation error.');
    });
    void readLocalModelManifest().then((manifest) => {
      if (active) setModelManifest(manifest);
    }).catch((error: unknown) => {
      if (active) setModelError(error instanceof Error ? error.message : 'The local model manifest could not be read.');
    });
    try {
      setNotes(loadNotes());
    } catch {
      setMessage(t.storageError);
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(async (registration) => {
        const keys = await caches.keys();
        setOfflineReady(Boolean(registration.active && keys.length > 0));
      }).catch(() => {
        setOfflineReady(false);
        setMessage(t.offlineCheckError);
      });
    }
    const promptListener = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', promptListener);
    return () => {
      active = false;
      window.removeEventListener('beforeinstallprompt', promptListener);
      window.removeEventListener('online', refreshWhenOnline);
    };
  }, []);

  function selectArea(id: string) {
    const cell = pickerCells.find((item) => item.id === id);
    if (!cell) return;
    setSelectedArea(id);
    setLocation({ lat: cell.lat, lng: cell.lng });
    setLocationLabel(cell.name);
    setMessage('');
  }

  function nearestAnchor(point: Coordinates, candidates: Anchor[] = anchors) {
    return candidates
      .map((anchor) => ({ anchor, distance: Math.hypot(anchor.lat - point.lat, (anchor.lng - point.lng) * Math.cos(point.lat * Math.PI / 180)) }))
      .sort((a, b) => a.distance - b.distance)[0].anchor;
  }

  async function useMyLocation() {
    setLocating(true);
    setMessage('');
    try {
      const { coordinates: point, accuracyMeters } = await requestDeviceLocation(navigator.geolocation, window.isSecureContext);
      const outsideBerlin = Math.hypot((point.lat - 52.52) * 111, (point.lng - 13.405) * 68) > 24;
      if (outsideBerlin) {
        const nearest = nearestAnchor(point, naturePack?.anchors ?? anchors);
        setLocation({ lat: nearest.lat, lng: nearest.lng });
        setLocationLabel(nearest.name);
        setSelectedArea('');
        setMessage(t.outsideBerlin);
        return;
      }
      setLocation(point);
      setLocationLabel('Your location');
      setSelectedArea('');
      setMessage(`${t.locationSuccess} (~${Math.max(50, Math.round(accuracyMeters / 50) * 50)} m).`);
    } catch (error) {
      if (!(error instanceof LocationRequestError)) {
        setMessage(t.locationUnavailable);
        return;
      }
      const failureMessage = {
        unsupported: t.noGps,
        'insecure-context': t.insecureLocation,
        'permission-denied': t.locationDenied,
        unavailable: t.locationUnavailable,
        timeout: t.locationTimeout,
        inaccurate: t.inaccurate,
      }[error.reason];
      setMessage(failureMessage);
    } finally {
      setLocating(false);
    }
  }

  function makeMission() {
    const plan = buildMission(
      location,
      minutes,
      missionWeather,
      new Date(),
      walkFraction,
      pace,
      language,
      {
        thunderstorm: outingConditions.thunderstorm || missionWeather === 'thunderstorm',
        icy: outingConditions.icy || missionWeather === 'snow_frost_ice',
        heat: outingConditions.heat,
      },
      forecast ? `${weatherStatus === 'stale' ? 'Stale' : 'Berlin forecast'} · ${forecastAgeLabel(forecast)}` : 'Forecast unavailable · manual conditions',
      naturePack
        ? {
            anchors: naturePack.anchors,
            species: naturePack.species,
            builtAt: naturePack.builtAt,
            speciesLocation: naturePack.evidence.type === 'observational-pilot' ? 'both' : 'origin',
          }
        : { anchors, species },
    );
    setMission(plan);
    setBriefing(templateBriefing(plan, language, formatDistance(plan.distanceKm, language), cardinalDirection(plan.bearing, language)));
    setModelComposition(null);
    setModelError('');
    setModelUsed(false);
    setModelProgress(null);
    setModelBusy(false);
    modelGeneration.current += 1;
    setPage('mission');
  }

  async function runModelExperiment(plan: Mission | null = mission) {
    if (!plan) return;
    const generation = ++modelGeneration.current;
    setModelBusy(true);
    setModelError('');
    setModelUsed(false);
    setModelComposition(language === 'en' ? templateMissionComposition(plan) : null);
    setModelProgress({ text: t.modelWorking, progress: 0 });
    try {
      const result = await composeLocalMission(
        plan,
        language,
        (progress) => {
          if (generation === modelGeneration.current) setModelProgress(progress);
        },
      );
      if (generation !== modelGeneration.current) return;
      setModelManifest(result.manifest);
      setModelComposition(result.composition);
      setModelUsed(true);
    } catch (error) {
      if (generation === modelGeneration.current) {
        setModelError(error instanceof Error ? error.message : 'The local rewrite failed. The template briefing is still available.');
      }
    } finally {
      if (generation === modelGeneration.current) setModelBusy(false);
    }
  }

  async function prepareLocalModel() {
    setModelBusy(true);
    setModelError('');
    setModelProgress({ text: 'Preparing the optional local model…', progress: 0 });
    try {
      const manifest = await loadLocalModel(setModelProgress);
      setModelManifest(manifest);
      setModelProgress({ text: t.modelLoaded, progress: 1 });
    } catch (error) {
      setModelError(error instanceof Error ? error.message : 'The local model could not be loaded.');
    } finally {
      setModelBusy(false);
    }
  }

  async function removeLocalModel() {
    setModelBusy(true);
    setModelError('');
    try {
      await deleteLocalModel();
      setModelProgress(null);
      setModelManifest(null);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : 'The local model could not be deleted.');
    } finally {
      setModelBusy(false);
    }
  }

  function addNote(speciesId: string) {
    const next = [...notes, { speciesId, date: localDateStamp() }];
    try {
      localStorage.setItem('nature-checklist', JSON.stringify(next));
      setNotes(next);
    } catch {
      setMessage(t.storageError);
    }
  }

  function clearNotes() {
    try {
      localStorage.removeItem('nature-checklist');
      setNotes([]);
    } catch {
      setMessage(t.storageError);
    }
  }

  function exportNotes() {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'nature-field-notes.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  const directionIcon = direction.includes('N') ? <ArrowUpRight aria-hidden="true" /> : direction.includes('S') ? <ArrowDownRight aria-hidden="true" /> : <ArrowRight aria-hidden="true" />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('plan')} aria-label={t.backHome}>
          <span className="brand-mark"><Leaf size={19} /></span><span>daily dose <i>of nature</i></span>
        </button>
        <div className="top-actions">
          <span className="offline-indicator"><span className="status-dot" />{offlineReady ? t.setup : 'Nature field guide'}</span>
          <label className="language-select">
            <span className="sr-only">{t.language}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={t.language}>
              <option value="en">EN</option><option value="de">DE</option><option value="fr">FR</option>
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <button className="icon-button" aria-label={t.settings} onClick={() => setPage('settings')}><Settings2 size={18} /></button>
        </div>
      </header>

      <main className="main-content">
        {page === 'plan' && (
          <section className="plan-layout">
            <div className="intro-column">
              <div className="mini-label"><span className="leaf-dot">✳</span>{t.eyebrow}</div>
              <h1>{t.title}</h1>
              <p className="intro-copy">{t.subtitle}</p>
              <div className="intro-note"><div className="note-icon"><Flower2 size={20} /></div><p>{t.themeText}</p></div>
              <div className="little-illustration" aria-hidden="true">
                <div className="sun-disc" /><div className="hill hill-back" /><div className="hill hill-front" />
                <div className="illustration-tree tree-left">🌳</div><div className="illustration-tree tree-right">🌲</div>
                <div className="illustration-flower">🌼</div><div className="illustration-bird">🐦</div>
                <span className="illustration-caption">a pocket-sized invitation</span>
              </div>
            </div>

            <div className="plan-card">
              <div className="card-heading"><div><span className="eyebrow">{t.location}</span><h2>Let’s find your patch.</h2></div><span className="card-stamp"><MapPin size={17} /></span></div>
              <div className="location-display"><div className="location-icon"><MapPin size={17} /></div><div><strong>{locationLabel}</strong><small>{t.locationSource}</small></div><button className="text-button" onClick={useMyLocation} disabled={locating}><Navigation size={14} />{locating ? t.locating : t.locate}</button></div>
              {message && <div className="inline-message" role="status"><CircleHelp size={16} />{message}</div>}
              {(message === t.insecureLocation || message === t.noGps || message === t.locationDenied || message === t.locationTimeout || message === t.locationUnavailable || message === t.inaccurate) && (
                <div className="permission-help">
                  <p>{message === t.locationDenied ? t.permissionSteps : message === t.insecureLocation ? t.insecureLocation : message === t.noGps ? t.noGps : t.locationServicesHelp}</p>
                  <div>
                    <a href="https://support.google.com/chrome/answer/142065?hl=en" target="_blank" rel="noreferrer">{t.chromeHelp}</a>
                    <a href="https://support.mozilla.org/kb/does-firefox-share-my-location-websites" target="_blank" rel="noreferrer">{t.firefoxHelp}</a>
                    <a href="https://support.apple.com/guide/safari/websites-ibrwe2159f50/mac" target="_blank" rel="noreferrer">{t.safariHelp}</a>
                    <a href="https://support.apple.com/guide/iphone/control-access-to-location-information-iph3dd5f9be/ios" target="_blank" rel="noreferrer">{t.appleLocationHelp}</a>
                  </div>
                </div>
              )}
              <div className="picker-heading"><span>{t.change}</span><span className="tiny-caption">{t.areaGridCaption}</span></div>
              <div className="offline-map" role="group" aria-label={t.change}>
                <svg className="map-land" viewBox="0 0 320 220" aria-hidden="true"><path d="M97 23 151 17 198 26 227 48 266 51 285 77 276 101 293 119 272 145 267 178 234 192 203 187 179 206 144 198 116 207 88 185 64 176 56 149 33 135 44 109 34 83 59 63 63 40Z" /></svg>
                <span className="map-river river-one" /><span className="map-river river-two" />
                {pickerCells.map((cell, index) => <button key={cell.id} className={`hex-cell ${selectedArea === cell.id ? 'is-selected' : ''}`} style={{ left: `${(cell.x / 320) * 100}%`, top: `${(cell.y / 220) * 100}%` }} onClick={() => selectArea(cell.id)} aria-pressed={selectedArea === cell.id} aria-label={cell.name} title={cell.name}><span>{String(index + 1).padStart(2, '0')}</span></button>)}
              </div>
              <p className="privacy-note"><ShieldCheck size={15} />{t.privacy}</p>
              <div className="form-divider" />
              <div className="setting-row"><div><span className="eyebrow">{t.minutes}</span><span className="setting-hint">A gentle walk, at your pace.</span></div><div className="number-input"><input type="number" min={5} max={360} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} aria-label={t.minutes} /><span>{t.min}</span></div></div>
              <div className="weather-row">
                <div className="weather-summary">
                  <span className="eyebrow">{t.currentWeather}</span>
                  <strong>{currentWeather ? <>{weatherIcon(currentWeather)} {t.conditions[currentWeather]}{currentHour && ` · ${Math.round(currentHour.temperatureC)}°C`}</> : weatherStatus === 'loading' ? t.weatherLoading : t.weatherUnavailable}</strong>
                </div>
                <div className="weather-control">
                  <span className="eyebrow">{t.weather} · {minutes} {t.min}</span>
                  <label className="weather-select"><span>{weatherIcon(missionWeather)} {t.conditions[missionWeather]}</span><select value={missionWeather} onChange={(event) => { const next = event.target.value as Weather; setWeather(next); setManualWeather(next); }} aria-label={t.weather}>{weatherOptions.map((value) => <option key={value} value={value}>{t.conditions[value]}</option>)}</select><ChevronDown size={15} /></label>
                </div>
              </div>
              <p className={`forecast-status forecast-status--${weatherStatus}`} aria-live="polite">{weatherStatus === 'loading' ? t.weatherLoading : weatherStatus === 'error' ? t.weatherError : weatherStatus === 'stale' ? t.weatherStale : `${weatherStatus === 'live' ? t.weatherLive : t.weatherCached} · ${t.weatherFreshness} ${forecast ? forecastAgeLabel(forecast) : ''}`}{weatherErrorDetail && <small className="forecast-error-detail">{weatherErrorDetail}</small>}</p>
              {weatherStatus === 'error' && <button className="weather-retry" onClick={() => void refreshWeather()}>{t.retryWeather}</button>}
              <button className="primary-button" onClick={makeMission} disabled={dataPackStatus === 'loading'}><span>{t.start}</span><ArrowRight size={18} /></button>
              <p className="starter-note">
                {dataPackStatus === 'loading' ? t.dataLoading : dataPackStatus === 'error' ? `${t.dataError} ${dataPackError}` :
                  naturePack?.evidence.type === 'observational-pilot'
                    ? `${t.observationalNotice} ${new Intl.NumberFormat(language).format(naturePack.evidence.acceptedRecordCount ?? 0)} ${t.observationRecords}.`
                    : t.freshness}
              </p>
            </div>
          </section>
        )}

        {page === 'mission' && mission && (
          <section className="mission-page">
            <button className="back-link" onClick={() => setPage('plan')}><ArrowLeft size={16} />{t.back}</button>
            <div className="mission-banner">
              <div><span className="eyebrow">{t.today}</span><h1>{t.head}</h1><p>{t.outdoors} <span className="banner-flower">✿</span></p></div>
              <div className="route-stamp"><Compass size={21} /><span>{mission.distanceKm > 0 ? `${formatDistance(mission.distanceKm, language)} · ${t.oneWay}` : t.nearby}</span><strong>{direction}</strong></div>
            </div>
            <article className="briefing-card">
              <div className="briefing-heading"><div><span className="eyebrow">{t.briefing}</span><p>{modelBusy && modelProgress
                ? `${modelProgress.text} ${Math.round(modelProgress.progress * 100)}%`
                : modelUsed ? t.modelUsed : modelError ? t.modelFallback : t.template}</p></div><span className="briefing-flower">✿</span></div>
              {modelComposition
                ? <div className="generated-mission">
                    <span className="eyebrow">{t.objective}</span>
                    <h2>{modelComposition.objective}</h2>
                    <span className="eyebrow">{t.observations}</span>
                    <ol>{modelComposition.steps.map((item) => <li key={item.id}>
                      <strong>{speciesDisplayName(item, 'en').name}</strong>
                      <span>{item.fieldcraft.en}</span>
                    </li>)}</ol>
                    <p><strong>{t.alternative}: {speciesDisplayName(modelComposition.alternative, 'en').name}.</strong> {modelComposition.alternative.fieldcraft.en}</p>
                    <p className="generated-conduct">{t.putAway}</p>
                  </div>
                : <p className="briefing-copy">{briefing}</p>}
              {language === 'en' && !mission.safety && <button className="text-button briefing-action" onClick={() => void runModelExperiment()} disabled={modelBusy}><RefreshCw size={14} />{modelUsed ? t.retryModel : t.tryModel}</button>}
              {modelError && <p className="model-error" role="status">{modelError}</p>}
            </article>
            <div className="mission-grid">
              <div className="mission-main">
                <article className="destination-card">
                  <div className="destination-top"><span className="eyebrow">{t.route}</span><span className="tag"><TreePine size={14} />{t.point}</span></div>
                  <h2>{mission.anchor.name}</h2>
                  <p className="destination-habitat">{mission.anchor.habitat}</p>
                  <div className="route-summary">
                    <div className="route-arrow">{directionIcon}</div>
                    <div><strong>{mission.distanceKm > 0 ? `${formatDistance(mission.distanceKm, language)} ${direction} · ${t.oneWay}` : t.nearby}</strong><span>{mission.walkMinutes} min {t.walk} · {mission.observeMinutes} min {t.observe}</span></div>
                    <span className="route-wash">🌿</span>
                  </div>
                  <div className="timing-chips"><span><Sun size={14} />{weatherIcon(mission.context)} {t.conditions[mission.context]}</span><span><Moon size={14} />{mission.freshness}</span></div>
                </article>
                {mission.safety && <div className="safety-card"><ShieldCheck size={19} /><div><strong>{t.safety}</strong><p>{mission.safety}</p></div></div>}
                <div className="species-section-heading"><div><span className="eyebrow">{t.band}</span><h2>{t.targets}</h2></div><span className="species-count">{String(mission.targets.length).padStart(2, '0')} <span>little chances</span></span></div>
                {mission.nearbyEvidenceCell && <p className="evidence-note">{t.nearbyEvidenceNote}</p>}
                {mission.nearbyEvidenceCell && mission.targets.length === 0
                  ? <p className="evidence-note">{t.noNearbyRecords}</p>
                  : <div className="species-list">{mission.targets.map((item, index) => <SpeciesCard key={item.id} item={item} index={index + 1} language={language} onAdd={addNote} alreadyAdded={notes.some((note) => note.speciesId === item.id && note.date === today)} t={t} nearbyEvidenceCell={mission.nearbyEvidenceCell} />)}</div>}
                <div className="gems-heading"><span className="gem-star">✦</span><div><h2>{t.gems}</h2><p>A softer sort of treasure hunt.</p></div></div>
                <div className="gem-list">{mission.gems.map((item) => <SpeciesCard key={item.id} item={item} index={null} language={language} onAdd={addNote} alreadyAdded={notes.some((note) => note.speciesId === item.id && note.date === today)} t={t} gem nearbyEvidenceCell={mission.nearbyEvidenceCell} />)}</div>
                <div className="conduct-card"><span className="conduct-icon"><Leaf size={17} /></span><div><strong>Kind eyes, light feet</strong><p>{codeOfConduct}</p></div></div>
              </div>
              <aside className="mission-aside">
                <div className="aside-card phone-card"><div className="phone-flower">🌱</div><span className="eyebrow">{t.theme}</span><p>{t.themeText}</p><span className="aside-signature">— your pocket naturalist</span></div>
                <div className="aside-card data-card">
                  <span className="eyebrow">A NOTE ABOUT THE GUIDE</span>
                  <p>{naturePack?.evidence.type === 'observational-pilot' ? t.observationalDisclaimer : mission.dataBuiltAt ? t.dataBacked : t.data}</p>
                  <small>
                    {naturePack?.evidence.type === 'observational-pilot'
                      ? `${new Intl.NumberFormat(language).format(naturePack.evidence.acceptedRecordCount ?? 0)} ${t.observationRecords} · ${naturePack.evidence.observedFrom} – ${naturePack.evidence.observedTo} · ${naturePack.evidence.publishedTaxa} taxa`
                      : mission.dataBuiltAt ? new Date(mission.dataBuiltAt).toLocaleDateString(language) : t.freshness}
                  </small>
                  {naturePack && <a href={naturePack.evidence.sourceDoi} target="_blank" rel="noreferrer">{t.sourceLink}</a>}
                </div>
                <button className="secondary-button" onClick={() => setPage('checklist')}><BookOpen size={17} />{t.checklist}<ArrowRight size={16} /></button>
              </aside>
            </div>
          </section>
        )}

        {page === 'checklist' && (
          <section className="simple-page">
            <button className="back-link" onClick={() => setPage(mission ? 'mission' : 'plan')}><ArrowLeft size={16} />{t.backHome}</button>
            <div className="simple-heading"><span className="eyebrow">A pocket field journal</span><h1>{t.checklist}<span className="heading-flower">✿</span></h1><p>Only species IDs and dates live in this list. No location is ever saved.</p></div>
            <div className="journal-card">
              {notes.length ? notes.map((note, index) => {
                const item = displaySpecies.find((entry) => entry.id === note.speciesId);
                const displayName = item ? speciesDisplayName(item, language).name : '';
                const photoCredit = item ? photoCreditFor(item) : undefined;
                return item ? <div className="journal-row" key={`${note.speciesId}-${note.date}-${index}`}><SpeciesArt item={item} small /><div><strong>{displayName}</strong><span>{item.scientific_name && item.scientific_name !== displayName ? `${item.scientific_name} · ` : ''}{note.date} · {t.groups[item.group]}</span>{photoCredit && <small className="photo-credit">{photoCredit.attribution} · {photoCredit.licenseUrl ? <a href={photoCredit.licenseUrl} target="_blank" rel="noreferrer">{photoCredit.license}</a> : photoCredit.license}</small>}</div><Check size={17} /></div> : null;
              }) : <div className="empty-journal"><div>🍃</div><p>{t.empty}</p></div>}
              <div className="journal-actions"><span>{notes.length} {t.notes}</span><button className="text-button" onClick={exportNotes} disabled={!notes.length}><ArrowDownRight size={14} />{t.export}</button><button className="text-button danger-text" onClick={clearNotes} disabled={!notes.length}><X size={14} />{t.clear}</button></div>
            </div>
          </section>
        )}

        {page === 'about' && (
          <section className="simple-page">
            <button className="back-link" onClick={() => setPage('plan')}><ArrowLeft size={16} />{t.backHome}</button>
            <div className="simple-heading"><span className="eyebrow">Small app, open skies</span><h1>{t.about}<span className="heading-flower">✿</span></h1><p>{naturePack?.evidence.type === 'observational-pilot' ? t.observationalDisclaimer : naturePack ? t.dataBacked : t.openText}</p></div>
            <div className="about-grid">
              <InfoCard title={t.why} text={t.whyText} icon={<Leaf size={19} />} />
              <InfoCard title={t.known} text={naturePack?.evidence.type === 'observational-pilot' ? t.limitationText : t.demoLimitationText} icon={<CircleHelp size={19} />} />
              <InfoCard title={t.sources} text={naturePack?.evidence.type === 'observational-pilot'
                ? `${naturePack.evidence.sourceTitle} · ${naturePack.evidence.sourceDoi} · ${naturePack.evidence.acceptedRecordCount} filtered records. CC0 and CC BY 4.0 records only; exact observation coordinates are not included in the pack.`
                : `${naturePack ? t.dataBacked : t.openText} GBIF record and image licences must be preserved; Open-Meteo is CC BY 4.0; OpenStreetMap / Geofabrik is ODbL with attribution and share-alike obligations.`} icon={<BookOpen size={19} />} />
              <InfoCard title="MIT licence" text="The application source code is intended to be released under the MIT License. This licence does not replace or relicense any third-party dataset." icon={<ShieldCheck size={19} />} />
            </div>
            <div className="outside-log"><span className="eyebrow">{t.outside}</span><p>{t.outsideText}</p></div>
          </section>
        )}

        {page === 'settings' && (
          <section className="simple-page">
            <button className="back-link" onClick={() => setPage('plan')}><ArrowLeft size={16} />{t.backHome}</button>
            <div className="simple-heading"><span className="eyebrow">A few gentle preferences</span><h1>{t.settings}<span className="heading-flower">✿</span></h1><p>Everything here stays on this device.</p></div>
            <div className="settings-card">
              <label className="settings-control"><span>{t.language}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="de">Deutsch</option><option value="fr">Français</option></select></label>
              <label className="settings-control"><span>{t.pace} <small>{pace} m/min</small></span><input type="range" min="40" max="100" value={pace} onChange={(event) => setPace(Number(event.target.value))} /></label>
              <label className="settings-control"><span>{t.fraction} <small>{Math.round(walkFraction * 100)}%</small></span><input type="range" min="30" max="80" value={Math.round(walkFraction * 100)} onChange={(event) => setWalkFraction(Number(event.target.value) / 100)} /></label>
              <div className="model-setting"><div className="model-icon">✨</div><div><strong>{t.model}</strong><p>{modelManifest?.enabled ? `${formatBytes(modelManifest.modelSizeBytes ?? 0)} · ${t.modelUnavailable} · revision ${modelManifest.revision?.slice(0, 8)} · SHA-256 pinned.` : t.modelUnavailable} {t.modelAdvice}</p></div><span className="soon-pill">ON-DEVICE</span></div>
              {modelProgress && <p className="model-progress">{modelProgress.text} · {Math.round(modelProgress.progress * 100)}%</p>}
              {modelError && <p className="model-error" role="status">{modelError}</p>}
              {modelManifest?.enabled
                ? <div className="model-actions"><button className="secondary-button" onClick={prepareLocalModel} disabled={modelBusy}><RefreshCw size={15} />{t.prepareModel}</button><button className="text-button danger-text" onClick={removeLocalModel} disabled={modelBusy}><X size={14} />{t.deleteModel}</button></div>
                : <p className="model-requirement">{t.modelAdvice} Storage quota of at least 2 GB and WebGPU are required where available.</p>}
              <div className="offline-setting"><span className="status-dot" /><div><strong>{offlineReady ? t.setup : t.ready}</strong><p>App shell and the available local nature guide are precached when installed.</p></div><RefreshCw size={17} /></div>
              {installPrompt && <button className="primary-button install-button" onClick={installApp}><span>Install app</span><ArrowRight size={17} /></button>}
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <div className="footer-left"><span className="footer-leaf">✿</span><span>Made for slow mornings & curious minds.</span></div>
        <div className="footer-links"><button onClick={() => setPage('checklist')}>{t.checklist}</button><button onClick={() => setPage('about')}>{t.about}</button><button onClick={() => setPage('settings')}>{t.settings}</button></div>
        <span className="footer-lock"><ShieldCheck size={14} />{t.locationFooter}</span>
      </footer>
    </div>
  );
}

function weatherIcon(weather: Weather) {
  if (weather === 'dry_sunny') return <Sun size={15} />;
  if (weather === 'snow_frost_ice') return <span aria-hidden="true">❄</span>;
  if (weather === 'thunderstorm') return <span aria-hidden="true">⚡</span>;
  if (weather === 'light_rain' || weather === 'heavy_rain') return <span aria-hidden="true">☂</span>;
  return <span aria-hidden="true">☁</span>;
}

function SpeciesCard({ item, index, language, onAdd, alreadyAdded, t, gem = false, nearbyEvidenceCell = null }: {
  item: Species; index: number | null; language: Language; onAdd: (id: string) => void;
  alreadyAdded: boolean; t: (typeof copy)[Language]; gem?: boolean; nearbyEvidenceCell?: string | null;
}) {
  const displayName = speciesDisplayName(item, language);
  const name = displayName.name;
  const localSupport = nearbyEvidenceCell ? item.cell_rates?.[nearbyEvidenceCell]?.support : undefined;
  const photoCredit = photoCreditFor(item);
  return (
    <article className={`species-card ${gem ? 'gem-card' : ''}`}>
      <div className="species-number">{gem ? <span className="gem-star">✦</span> : `0${index}`}</div>
      <SpeciesArt item={item} />
      <div className="species-info">
        <span className="species-group">{t.groups[item.group]} <span>·</span> {gem ? t.gems : item.observation_count ? t.observedMonths : t.activity}</span>
        <h3>{name}</h3>
        {item.common_names && displayName.commonNameLanguage && displayName.commonNameLanguage !== language
          ? <small className="species-evidence">{t.nameLanguageLabels[displayName.commonNameLanguage]}</small>
          : null}
        {item.scientific_name && item.scientific_name !== name
          ? <small className="species-evidence">{item.scientific_name}</small>
          : item.scientific_name && displayName.commonNameLanguage === null && <small className="species-evidence">{t.scientificNameNote}</small>}
        {localSupport
          ? <small className="species-evidence">{new Intl.NumberFormat(language).format(localSupport)} {t.nearbyObservations}</small>
          : item.observation_count && <small className="species-evidence">{new Intl.NumberFormat(language).format(item.observation_count)} {t.observationRecords}</small>}
        <p className="fieldcraft-label">{t.fieldcraft}</p>
        <p className="fieldcraft-copy">{item.fieldcraft[language]}</p>
        {photoCredit && (
          <small className="photo-credit">
            {photoCredit.attribution}
            {' · '}
            {photoCredit.licenseUrl
              ? <a href={photoCredit.licenseUrl} target="_blank" rel="noreferrer">{photoCredit.license}</a>
              : photoCredit.license}
          </small>
        )}
      </div>
      <button className={`spot-button ${alreadyAdded ? 'spot-button--added' : ''}`} onClick={() => onAdd(item.id)} aria-label={`${t.save}: ${name}`} disabled={alreadyAdded}>{alreadyAdded ? <Check size={16} /> : <Leaf size={16} />}<span>{alreadyAdded ? t.saved : t.save}</span></button>
    </article>
  );
}

function InfoCard({ title, text, icon }: { title: string; text: string; icon: React.ReactNode }) {
  return <article className="info-card"><div className="info-icon">{icon}</div><h2>{title}</h2><p>{text}</p></article>;
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

export default App;
