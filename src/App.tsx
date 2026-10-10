import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight,
  BookOpen, Check, ChevronDown, CircleHelp, Compass, Flower2, Leaf, MapPin,
  Moon, Navigation, RefreshCw, Settings2, ShieldCheck, Sun, TreePine, X,
} from 'lucide-react';
import { buildMission, cardinalDirection, formatDistance, type Coordinates, type Mission } from './engine';
import { anchors, pickerCells, species, weatherOptions, type Language, type Species, type Weather } from './data';

type Page = 'plan' | 'mission' | 'checklist' | 'about' | 'settings';
type CheckIn = { speciesId: string; date: string };

const copy = {
  en: {
    eyebrow: 'A little field note for today', title: 'Your daily dose\nof nature.', subtitle: 'A small reason to step outside. A whole world to notice.',
    location: 'Your patch of Berlin', locate: 'Use my location', locating: 'Finding you…', change: 'Choose a nearby area',
    minutes: 'How long have you got?', min: 'min', weather: 'Sky right now', start: 'Find my little adventure',
    privacy: 'Your location stays on this phone. No account, no tracking, no map tiles.',
    mission: 'Your nature note', back: 'Change my plan', today: 'TODAY’S LITTLE ADVENTURE',
    head: 'A green little detour', walk: 'walk', observe: 'noticing', away: 'away', route: 'Your destination',
    targets: 'Keep an eye out for', gems: 'Little treasures', fieldcraft: 'A tiny field tip',
    safety: 'A gentle safety note', conduct: 'Stay on paths, keep your distance, take nothing, and follow signs in nature reserves.',
    save: 'I spotted this', saved: 'Added to my field notes', checklist: 'Field notes', empty: 'Nothing spotted yet. The first little discovery is yours.',
    notes: 'sightings', clear: 'Clear notes', export: 'Export notes', about: 'About this little app', settings: 'Settings',
    backHome: 'Back to today', data: 'Starter nature guide · illustrative, not live sighting data',
    freshness: 'This is a seasonal starter guide, not a promise that a species is here today.',
    setup: 'Offline ready', theme: 'A little note before you go', themeText: 'You do not need to know names to belong outdoors. Take your time, notice one small thing, and let the phone rest.',
    sources: 'Open data & attribution', openText: 'This prototype is built to grow from open data. Its small starter guide is hand-written sample content and is not backed by local occurrence records yet.',
    why: 'Why open matters', whyText: 'Offline in a park with no signal. Private location by design. Swappable open-weight models. No running cost for a server.',
    known: 'Known limitations', limitationText: 'Observer bias shapes any sightings dataset. Relative likelihood is not a guarantee. Data age matters. The current starter guide is illustrative, and route access, lighting and weather are not live-verified.',
    outside: 'I took it outside', outsideText: 'Date: ____   Area (not exact coordinates): ____   One thing I noticed: ____   What surprised me: ____',
    language: 'Language', pace: 'Walking pace', fraction: 'Time spent walking', model: 'On-device story helper',
    modelText: 'Optional WebGPU / WASM model support is not connected in this prototype. Your template note works without it.',
    ready: 'Works offline after first load', noGps: 'Location was not shared. Choose a hex below instead.',
    outsideBerlin: 'That looks outside Berlin. I’ve moved the start to the nearest public green path.',
    inaccurate: 'That location was too fuzzy to plan from. Pick a nearby area below.',
    noLocation: 'Could not read your location. Choose an area below.',
    storageError: 'Could not read or save your field notes on this device.',
    offlineCheckError: 'The offline cache could not be checked. Keep this page open while it finishes loading.',
    conditions: { dry_sunny: 'Sunny', dry_overcast: 'Overcast', light_rain: 'Drizzle', heavy_rain: 'Heavy rain', snow_frost_ice: 'Frost / ice', thunderstorm: 'Thunderstorm' },
    groups: { Bird: 'Bird', Plant: 'Plant', Mammal: 'Mammal', Invertebrate: 'Invertebrate', Fungi: 'Fungi' },
    todayDate: 'Built for this moment', point: 'little green start', outdoors: 'Go gently. Look closely.',
    activity: 'In season', band: 'Seasonal pick', for: 'for your patch',
  },
  de: {
    eyebrow: 'Eine kleine Notiz für heute', title: 'Deine tägliche\nDosis Natur.', subtitle: 'Ein kleiner Grund rauszugehen. Eine ganze Welt zum Entdecken.',
    location: 'Dein Stück Berlin', locate: 'Meinen Standort nutzen', locating: 'Standort wird gesucht…', change: 'Gebiet in der Nähe wählen',
    minutes: 'Wie viel Zeit hast du?', min: 'Min.', weather: 'Das Wetter gerade', start: 'Mein kleines Abenteuer finden',
    privacy: 'Dein Standort bleibt auf diesem Handy. Kein Konto, kein Tracking, keine Kartenkacheln.',
    mission: 'Deine Natur-Notiz', back: 'Plan ändern', today: 'DEIN KLEINES ABENTEUER',
    head: 'Ein grüner kleiner Umweg', walk: 'Weg', observe: 'Entdecken', away: 'entfernt', route: 'Dein Ziel',
    targets: 'Halte Ausschau nach', gems: 'Kleine Schätze', fieldcraft: 'Ein kleiner Beobachtungstipp',
    safety: 'Ein sanfter Sicherheitshinweis', conduct: 'Bleib auf den Wegen, halte Abstand, nimm nichts mit und beachte die Schilder im Naturschutzgebiet.',
    save: 'Habe ich entdeckt', saved: 'In deinen Notizen gespeichert', checklist: 'Natur-Notizen', empty: 'Noch nichts entdeckt. Die erste kleine Entdeckung wartet auf dich.',
    notes: 'Funde', clear: 'Notizen löschen', export: 'Notizen exportieren', about: 'Über diese kleine App', settings: 'Einstellungen',
    backHome: 'Zurück zu heute', data: 'Natur-Startguide · beispielhaft, keine aktuellen Funddaten',
    freshness: 'Dies ist ein saisonaler Startguide, keine Garantie, dass eine Art heute hier ist.',
    setup: 'Offline bereit', theme: 'Eine kleine Notiz, bevor du losgehst', themeText: 'Du musst keine Namen kennen, um draußen dazuzugehören. Lass dir Zeit, entdecke eine Kleinigkeit und leg das Handy weg.',
    sources: 'Offene Daten & Quellen', openText: 'Dieser Prototyp ist dafür gebaut, mit offenen Daten zu wachsen. Der kleine Startguide ist von Hand geschriebener Beispielinhalt und noch nicht mit lokalen Funddaten verknüpft.',
    why: 'Warum offene Daten wichtig sind', whyText: 'Offline im Park ohne Empfang. Privater Standort. Austauschbare Open-Weight-Modelle. Keine laufenden Serverkosten.',
    known: 'Bekannte Einschränkungen', limitationText: 'Beobachtungs-Bias prägt jeden Funddatensatz. Relative Wahrscheinlichkeit ist keine Garantie. Das Alter der Daten ist wichtig. Der aktuelle Startguide ist beispielhaft; Wegezugang, Beleuchtung und Wetter werden nicht live geprüft.',
    outside: 'Ich war draußen', outsideText: 'Datum: ____   Gebiet (keine genauen Koordinaten): ____   Eine Entdeckung: ____   Das hat mich überrascht: ____',
    language: 'Sprache', pace: 'Gehgeschwindigkeit', fraction: 'Zeit zu Fuß', model: 'Lokaler Geschichtenhelfer',
    modelText: 'Optionale WebGPU-/WASM-Modellunterstützung ist in diesem Prototyp noch nicht verbunden. Die Vorlage funktioniert ohne Modell.',
    ready: 'Nach dem ersten Laden offline nutzbar', noGps: 'Standort nicht geteilt. Wähle stattdessen unten ein Sechseck.',
    outsideBerlin: 'Das scheint außerhalb Berlins zu sein. Der Startpunkt wurde zum nächsten öffentlichen Grünweg verschoben.',
    inaccurate: 'Der Standort war zu ungenau. Wähle unten ein Gebiet in der Nähe.',
    noLocation: 'Standort konnte nicht gelesen werden. Wähle unten ein Gebiet.',
    storageError: 'Deine Natur-Notizen konnten auf diesem Gerät nicht gelesen oder gespeichert werden.',
    offlineCheckError: 'Der Offline-Cache konnte nicht geprüft werden. Lass die Seite geöffnet, bis sie fertig geladen ist.',
    conditions: { dry_sunny: 'Sonnig', dry_overcast: 'Bewölkt', light_rain: 'Nieselregen', heavy_rain: 'Starker Regen', snow_frost_ice: 'Frost / Eis', thunderstorm: 'Gewitter' },
    groups: { Bird: 'Vogel', Plant: 'Pflanze', Mammal: 'Säugetier', Invertebrate: 'Wirbellose', Fungi: 'Pilz' },
    todayDate: 'Für diesen Moment', point: 'kleiner grüner Start', outdoors: 'Geh sanft. Schau genau hin.',
    activity: 'Saison', band: 'Saison-Tipp', for: 'in deiner Nähe',
  },
  fr: {
    eyebrow: 'Une petite note de terrain pour aujourd’hui', title: 'Ta dose quotidienne\nde nature.', subtitle: 'Une petite raison de sortir. Tout un monde à remarquer.',
    location: 'Ton coin de Berlin', locate: 'Utiliser ma position', locating: 'Je te cherche…', change: 'Choisir un quartier proche',
    minutes: 'Tu as combien de temps ?', min: 'min', weather: 'Le ciel en ce moment', start: 'Trouver ma petite aventure',
    privacy: 'Ta position reste sur ce téléphone. Pas de compte, pas de suivi, pas de tuiles cartographiques.',
    mission: 'Ta note nature', back: 'Modifier mon programme', today: 'TA PETITE AVENTURE DU JOUR',
    head: 'Un petit détour tout vert', walk: 'marche', observe: 'observation', away: 'à pied', route: 'Ta destination',
    targets: 'Ouvre l’œil pour', gems: 'Petits trésors', fieldcraft: 'Un mini-conseil de terrain',
    safety: 'Un petit rappel de sécurité', conduct: 'Reste sur les sentiers, garde tes distances, ne prends rien et respecte les panneaux des réserves.',
    save: 'Je l’ai aperçu', saved: 'Ajouté à tes notes', checklist: 'Notes de terrain', empty: 'Rien aperçu pour le moment. Ta première découverte t’attend.',
    notes: 'observations', clear: 'Effacer les notes', export: 'Exporter les notes', about: 'À propos de cette appli', settings: 'Réglages',
    backHome: 'Retour à aujourd’hui', data: 'Guide nature de départ · illustratif, pas des observations récentes',
    freshness: 'Ce guide saisonnier ne garantit pas qu’une espèce soit présente aujourd’hui.',
    setup: 'Prêt hors ligne', theme: 'Un petit mot avant de partir', themeText: 'Pas besoin de connaître les noms pour avoir ta place dehors. Prends ton temps, remarque un détail et range ton téléphone.',
    sources: 'Données ouvertes & attribution', openText: 'Ce prototype est conçu pour grandir grâce aux données ouvertes. Son petit guide est un contenu d’exemple écrit à la main, sans observations locales pour le moment.',
    why: 'Pourquoi l’ouverture compte', whyText: 'Hors ligne dans un parc sans réseau. Position privée par défaut. Modèles ouverts interchangeables. Aucun coût de serveur.',
    known: 'Limites connues', limitationText: 'Les biais d’observation influencent les données. Une probabilité relative n’est pas une garantie. L’âge des données compte. Le guide actuel est illustratif ; accès, éclairage et météo ne sont pas vérifiés en direct.',
    outside: 'Je l’ai emmenée dehors', outsideText: 'Date : ____   Quartier (pas de coordonnées précises) : ____   Une chose remarquée : ____   Ce qui m’a surpris : ____',
    language: 'Langue', pace: 'Allure de marche', fraction: 'Temps de marche', model: 'Assistant local',
    modelText: 'Le modèle facultatif WebGPU / WASM n’est pas connecté dans ce prototype. La note modèle fonctionne sans.',
    ready: 'Fonctionne hors ligne après le premier chargement', noGps: 'Position non partagée. Choisis plutôt un hexagone ci-dessous.',
    outsideBerlin: 'Cela semble hors de Berlin. Le départ a été déplacé au chemin vert public le plus proche.',
    inaccurate: 'Position trop imprécise. Choisis un quartier proche ci-dessous.',
    noLocation: 'Position introuvable. Choisis un quartier ci-dessous.',
    storageError: 'Impossible de lire ou d’enregistrer tes notes sur cet appareil.',
    offlineCheckError: 'Le cache hors ligne n’a pas pu être vérifié. Garde cette page ouverte pendant le chargement.',
    conditions: { dry_sunny: 'Ensoleillé', dry_overcast: 'Couvert', light_rain: 'Bruine', heavy_rain: 'Forte pluie', snow_frost_ice: 'Gel / verglas', thunderstorm: 'Orage' },
    groups: { Bird: 'Oiseau', Plant: 'Plante', Mammal: 'Mammifère', Invertebrate: 'Invertébré', Fungi: 'Champignon' },
    todayDate: 'Préparé pour cet instant', point: 'petit départ vert', outdoors: 'Doucement. Ouvre l’œil.',
    activity: 'De saison', band: 'Idée de saison', for: 'près de chez toi',
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
    species.some((entry) => entry.id === item.speciesId);
  if (!parsed.every(isCheckIn)) throw new Error('Invalid field notes');
  return parsed;
}

function localDateStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function SpeciesArt({ item, small = false }: { item: Species; small?: boolean }) {
  return (
    <div className={`species-art ${small ? 'species-art--small' : ''}`} aria-label={item.names.en} role="img">
      <span className="art-sun" />
      <span className="art-emoji" aria-hidden="true">{item.emoji}</span>
      <span className="art-grass grass-one" />
      <span className="art-grass grass-two" />
    </div>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>('en');
  const t = copy[language];
  const [page, setPage] = useState<Page>('plan');
  const [minutes, setMinutes] = useState(40);
  const [weather, setWeather] = useState<Weather>('dry_sunny');
  const [location, setLocation] = useState<Coordinates>({ lat: 52.52, lng: 13.405 });
  const [selectedArea, setSelectedArea] = useState('center');
  const [locationLabel, setLocationLabel] = useState('Central Berlin');
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const [mission, setMission] = useState<Mission | null>(null);
  const [notes, setNotes] = useState<CheckIn[]>([]);
  const [pace, setPace] = useState(75);
  const [walkFraction, setWalkFraction] = useState(0.6);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  const direction = useMemo(() => mission ? cardinalDirection(mission.bearing, language) : 'N', [mission, language]);
  const codeOfConduct = t.conduct;
  const today = localDateStamp();

  useEffect(() => {
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
    return () => window.removeEventListener('beforeinstallprompt', promptListener);
  }, []);

  function selectArea(id: string) {
    const cell = pickerCells.find((item) => item.id === id);
    if (!cell) return;
    setSelectedArea(id);
    setLocation({ lat: cell.lat, lng: cell.lng });
    setLocationLabel(cell.name);
    setMessage('');
  }

  function nearestAnchor(point: Coordinates) {
    return anchors
      .map((anchor) => ({ anchor, distance: Math.hypot(anchor.lat - point.lat, (anchor.lng - point.lng) * Math.cos(point.lat * Math.PI / 180)) }))
      .sort((a, b) => a.distance - b.distance)[0].anchor;
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage(t.noGps);
      return;
    }
    setLocating(true);
    setMessage('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        if (position.coords.accuracy > 150) {
          setMessage(t.inaccurate);
          return;
        }
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const outsideBerlin = Math.hypot((point.lat - 52.52) * 111, (point.lng - 13.405) * 68) > 24;
        if (outsideBerlin) {
          const nearest = nearestAnchor(point);
          setLocation({ lat: nearest.lat, lng: nearest.lng });
          setLocationLabel(nearest.name);
          setSelectedArea('');
          setMessage(t.outsideBerlin);
          return;
        }
        setLocation(point);
        setLocationLabel('Your location');
        setSelectedArea('');
      },
      () => {
        setLocating(false);
        setMessage(t.noLocation);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 },
    );
  }

  function makeMission() {
    const plan = buildMission(location, minutes, weather, new Date(), walkFraction, pace, language);
    setMission(plan);
    setPage('mission');
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
          <span className="offline-indicator"><span className="status-dot" />{offlineReady ? t.setup : 'Private by design'}</span>
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
              <div className="location-display"><div className="location-icon"><MapPin size={17} /></div><div><strong>{locationLabel}</strong><small>Berlin · held only in memory</small></div><button className="text-button" onClick={useMyLocation} disabled={locating}><Navigation size={14} />{locating ? t.locating : t.locate}</button></div>
              {message && <div className="inline-message" role="status"><CircleHelp size={16} />{message}</div>}
              <div className="picker-heading"><span>{t.change}</span><span className="tiny-caption">offline area picker</span></div>
              <div className="offline-map" role="group" aria-label={t.change}>
                <svg className="map-land" viewBox="0 0 320 220" aria-hidden="true"><path d="M97 23 151 17 198 26 227 48 266 51 285 77 276 101 293 119 272 145 267 178 234 192 203 187 179 206 144 198 116 207 88 185 64 176 56 149 33 135 44 109 34 83 59 63 63 40Z" /></svg>
                <span className="map-river river-one" /><span className="map-river river-two" />
                {pickerCells.map((cell) => <button key={cell.id} className={`hex-cell ${selectedArea === cell.id ? 'is-selected' : ''}`} style={{ left: `${(cell.x / 320) * 100}%`, top: `${(cell.y / 220) * 100}%` }} onClick={() => selectArea(cell.id)} aria-pressed={selectedArea === cell.id} aria-label={cell.name}><span>{selectedArea === cell.id ? '✳' : '·'}</span></button>)}
                <span className="map-label label-west">SPANDAU</span><span className="map-label label-east">PANKOW</span><span className="map-label label-south">TEMPELHOF</span>
              </div>
              <p className="privacy-note"><ShieldCheck size={15} />{t.privacy}</p>
              <div className="form-divider" />
              <div className="setting-row"><div><span className="eyebrow">{t.minutes}</span><span className="setting-hint">A gentle walk, at your pace.</span></div><div className="number-input"><input type="number" min={5} max={360} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} aria-label={t.minutes} /><span>{t.min}</span></div></div>
              <div className="weather-row"><span className="eyebrow">{t.weather}</span><label className="weather-select"><span>{weatherIcon(weather)} {t.conditions[weather]}</span><select value={weather} onChange={(event) => setWeather(event.target.value as Weather)} aria-label={t.weather}>{weatherOptions.map((value) => <option key={value} value={value}>{t.conditions[value]}</option>)}</select><ChevronDown size={15} /></label></div>
              <button className="primary-button" onClick={makeMission}><span>{t.start}</span><ArrowRight size={18} /></button>
              <p className="starter-note">{t.freshness}</p>
            </div>
          </section>
        )}

        {page === 'mission' && mission && (
          <section className="mission-page">
            <button className="back-link" onClick={() => setPage('plan')}><ArrowLeft size={16} />{t.back}</button>
            <div className="mission-banner">
              <div><span className="eyebrow">{t.today}</span><h1>{t.head}</h1><p>{t.outdoors} <span className="banner-flower">✿</span></p></div>
              <div className="route-stamp"><Compass size={21} /><span>{formatDistance(mission.distanceKm, language)}</span><strong>{direction}</strong></div>
            </div>
            <div className="mission-grid">
              <div className="mission-main">
                <article className="destination-card">
                  <div className="destination-top"><span className="eyebrow">{t.route}</span><span className="tag"><TreePine size={14} />{t.point}</span></div>
                  <h2>{mission.anchor.name}</h2>
                  <p className="destination-habitat">{mission.anchor.habitat}</p>
                  <div className="route-summary">
                    <div className="route-arrow">{directionIcon}</div>
                    <div><strong>{formatDistance(mission.distanceKm, language)} {direction}</strong><span>{mission.walkMinutes} {t.walk} · {mission.observeMinutes} min {t.observe}</span></div>
                    <span className="route-wash">🌿</span>
                  </div>
                  <div className="timing-chips"><span><Sun size={14} />{weatherIcon(mission.context)} {t.conditions[mission.context]}</span><span><Moon size={14} />{t.todayDate}</span></div>
                </article>
                {mission.safety && <div className="safety-card"><ShieldCheck size={19} /><div><strong>{t.safety}</strong><p>{mission.safety}</p></div></div>}
                <div className="species-section-heading"><div><span className="eyebrow">{t.band}</span><h2>{t.targets}</h2></div><span className="species-count">03 <span>little chances</span></span></div>
                <div className="species-list">{mission.targets.map((item, index) => <SpeciesCard key={item.id} item={item} index={index + 1} language={language} onAdd={addNote} alreadyAdded={notes.some((note) => note.speciesId === item.id && note.date === today)} t={t} />)}</div>
                <div className="gems-heading"><span className="gem-star">✦</span><div><h2>{t.gems}</h2><p>A softer sort of treasure hunt.</p></div></div>
                <div className="gem-list">{mission.gems.map((item) => <SpeciesCard key={item.id} item={item} index={null} language={language} onAdd={addNote} alreadyAdded={notes.some((note) => note.speciesId === item.id && note.date === today)} t={t} gem />)}</div>
                <div className="conduct-card"><span className="conduct-icon"><Leaf size={17} /></span><div><strong>Kind eyes, light feet</strong><p>{codeOfConduct}</p></div></div>
              </div>
              <aside className="mission-aside">
                <div className="aside-card phone-card"><div className="phone-flower">🌱</div><span className="eyebrow">{t.theme}</span><p>{t.themeText}</p><span className="aside-signature">— your pocket naturalist</span></div>
                <div className="aside-card data-card"><span className="eyebrow">A NOTE ABOUT THE GUIDE</span><p>{t.data}</p><small>{t.freshness}</small></div>
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
                const item = species.find((entry) => entry.id === note.speciesId);
                return item ? <div className="journal-row" key={`${note.speciesId}-${note.date}-${index}`}><SpeciesArt item={item} small /><div><strong>{item.names[language]}</strong><span>{note.date} · {t.groups[item.group]}</span></div><Check size={17} /></div> : null;
              }) : <div className="empty-journal"><div>🍃</div><p>{t.empty}</p></div>}
              <div className="journal-actions"><span>{notes.length} {t.notes}</span><button className="text-button" onClick={exportNotes} disabled={!notes.length}><ArrowDownRight size={14} />{t.export}</button><button className="text-button danger-text" onClick={clearNotes} disabled={!notes.length}><X size={14} />{t.clear}</button></div>
            </div>
          </section>
        )}

        {page === 'about' && (
          <section className="simple-page">
            <button className="back-link" onClick={() => setPage('plan')}><ArrowLeft size={16} />{t.backHome}</button>
            <div className="simple-heading"><span className="eyebrow">Small app, open skies</span><h1>{t.about}<span className="heading-flower">✿</span></h1><p>{t.openText}</p></div>
            <div className="about-grid">
              <InfoCard title={t.why} text={t.whyText} icon={<Leaf size={19} />} />
              <InfoCard title={t.known} text={t.limitationText} icon={<CircleHelp size={19} />} />
              <InfoCard title={t.sources} text="GBIF occurrence and taxon data (per-record licences must be carried through a future pack); iNaturalist research-grade observations (per-record licences); Open-Meteo historical and forecast weather, CC BY 4.0; OpenStreetMap / Geofabrik Berlin extract, ODbL attribution required for derived packs. This demo bundles no data from those sources." icon={<BookOpen size={19} />} />
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
              <div className="model-setting"><div className="model-icon">✨</div><div><strong>{t.model}</strong><p>{t.modelText}</p></div><span className="soon-pill">OPTIONAL</span></div>
              <div className="offline-setting"><span className="status-dot" /><div><strong>{offlineReady ? t.setup : t.ready}</strong><p>App shell and sample field guide are precached when installed.</p></div><RefreshCw size={17} /></div>
              {installPrompt && <button className="primary-button install-button" onClick={installApp}><span>Install app</span><ArrowRight size={17} /></button>}
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <div className="footer-left"><span className="footer-leaf">✿</span><span>Made for slow mornings & curious minds.</span></div>
        <div className="footer-links"><button onClick={() => setPage('checklist')}>{t.checklist}</button><button onClick={() => setPage('about')}>{t.about}</button><button onClick={() => setPage('settings')}>{t.settings}</button></div>
        <span className="footer-lock"><ShieldCheck size={14} />no location leaves this phone</span>
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

function SpeciesCard({ item, index, language, onAdd, alreadyAdded, t, gem = false }: {
  item: Species; index: number | null; language: Language; onAdd: (id: string) => void;
  alreadyAdded: boolean; t: (typeof copy)[Language]; gem?: boolean;
}) {
  return (
    <article className={`species-card ${gem ? 'gem-card' : ''}`}>
      <div className="species-number">{gem ? <span className="gem-star">✦</span> : `0${index}`}</div>
      <SpeciesArt item={item} />
      <div className="species-info">
        <span className="species-group">{t.groups[item.group]} <span>·</span> {gem ? t.gems : t.activity}</span>
        <h3>{item.names[language]}</h3>
        <p className="fieldcraft-label">{t.fieldcraft}</p>
        <p className="fieldcraft-copy">{item.fieldcraft[language]}</p>
      </div>
      <button className={`spot-button ${alreadyAdded ? 'spot-button--added' : ''}`} onClick={() => onAdd(item.id)} aria-label={`${t.save}: ${item.names[language]}`} disabled={alreadyAdded}>{alreadyAdded ? <Check size={16} /> : <Leaf size={16} />}<span>{alreadyAdded ? t.saved : t.save}</span></button>
    </article>
  );
}

function InfoCard({ title, text, icon }: { title: string; text: string; icon: React.ReactNode }) {
  return <article className="info-card"><div className="info-icon">{icon}</div><h2>{title}</h2><p>{text}</p></article>;
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

export default App;
