import type { CategoryType, SeverityLevel, LocationInfo, ReportSource } from '../src/types/incident.js';

/**
 * Whole-word/whole-phrase match — NOT `.includes()`. A bare substring check matches inside
 * unrelated words ('fire' inside "fired"/"misfire", 'rains' inside "brains", 'dead' inside
 * "deadline", 'up'/'met' inside "erupt"/"disrupted" — the last two already caused real false
 * positives in production, see CLAUDE.md Investigation Log 2026-08-15/16). Every keyword list in
 * this file is matched through this helper for that reason. Compiled regexes are cached since
 * these run over every fetched report on every ingestion pass.
 *
 * This does NOT solve keywords that are legitimate whole words in an unrelated context (e.g.
 * 'hospital' or 'depression' appearing in non-disaster news) — that's a semantic ambiguity a
 * keyword matcher can't resolve, not a substring bug. See CLAUDE.md Known Gotchas.
 */
const keywordRegexCache = new Map<string, RegExp>();
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function buildKeywordRegex(keyword: string): RegExp {
  // \b only makes sense between a \w and \W character — a handful of terms start or end with
  // punctuation on purpose ('#inwx', 'udise+'), where a \b on that side would never match at
  // all (both the punctuation and typical surrounding whitespace are \W, so no transition
  // exists). Only add the boundary on sides that actually start/end with a word character.
  const prefix = /^\w/.test(keyword) ? '\\b' : '';
  const suffix = /\w$/.test(keyword) ? '\\b' : '';
  return new RegExp(`${prefix}${escapeRegExp(keyword)}${suffix}`);
}
export function containsKeyword(lowerText: string, keyword: string): boolean {
  let re = keywordRegexCache.get(keyword);
  if (!re) {
    re = buildKeywordRegex(keyword);
    keywordRegexCache.set(keyword, re);
  }
  return re.test(lowerText);
}

// Keywords dictionary for category classification (Expanded for live news dispatches)
const CATEGORY_KEYWORDS: Record<CategoryType, string[]> = {
  flood: [
    'flood', 'flooding', 'flooded', 'floodwater', 'floodwaters', 'inundation', 'waterlogging',
    'waterlogged', 'submerged', 'overflow', 'overflowing', 'brahmaputra', 'ganga', 'yamuna',
    'surge', 'deluge', 'drowning', 'drowned', 'heavy rain', 'heavy rainfall', 'rivers rise',
    'danger mark', 'downpour', 'monsoon rain', 'torrents', 'dam opened', 'sluice gates',
    'inundated', 'water level', 'rain alert', 'rains', 'waterlogging in'
  ],
  fire: [
    'fire', 'wildfire', 'bushfire', 'blaze', 'blazing', 'explosion', 'flames', 'chemical leak',
    'inferno', 'combustion', 'smoke', 'gas leak', 'toxic fumes', 'firefighters', 'fire tender'
  ],
  earthquake: [
    'earthquake', 'tremor', 'quake', 'seismic', 'epicenter', 'aftershock', 'faultline', 
    'magnitude', 'seismograph'
  ],
  cyclone: [
    'cyclone', 'storm', 'typhoon', 'hurricane', 'landfall', 'squall', 'gale', 'bay of bengal', 
    'depression', 'met forecasts', 'red alert', 'orange alert', 'imd warns', 'weather alert', 
    'cyclonic storm'
  ],
  building_collapse: [
    'collapse', 'collapsed', 'collapsing', 'rubble', 'structural failure', 'cave-in', 
    'building fell', 'masonry', 'wall collapsed', 'bridge collapse', 'house collapsed', 
    'structure collapse'
  ],
  medical: [
    'medical emergency', 'trauma', 'epidemic', 'heatwave', 'casualty', 'dengue', 'cholera', 
    'ambulance', 'hospital', 'injured', 'drowned', 'drowning', 'fatalities', 'rescued', 
    'heat stroke', 'outbreak', 'poisoning'
  ],
  landslide: [
    'landslide', 'mudslide', 'cloudburst', 'rockfall', 'debris flow', 'sludge', 'boulder fall',
    'earthmover', 'blocked by landslide', 'road blocked'
  ],
};

// Category check order for classifyCategory — deliberately NOT the same as CATEGORY_KEYWORDS'
// key order above. 'medical' is checked LAST: its keywords ('injured', 'hospital', 'rescued',
// 'casualty', 'ambulance') are companion vocabulary that shows up in almost every real disaster
// report regardless of the actual hazard (a landslide report legitimately says "injured", a
// flood report legitimately says "hospital"). Checking 'medical' early meant a genuine landslide
// or flood report matched 'medical' first and never got a chance to match its real category —
// e.g. "Wayanad landslide: Death toll rises to 3... injured several people" was classified
// medical instead of landslide (see CLAUDE.md Investigation Log 2026-08-16, ninth entry). This
// is a systemic fix, not a one-off FORBIDDEN_TERMS patch: it only changes behavior when BOTH a
// specific-hazard keyword AND a medical-adjacent word are present, which is the common case for
// real disaster news — a pure medical-only story (no flood/fire/earthquake/cyclone/
// building_collapse/landslide keyword present) still correctly falls through to 'medical'.
const CATEGORY_CHECK_ORDER: CategoryType[] = [
  'flood', 'fire', 'earthquake', 'cyclone', 'building_collapse', 'landslide', 'medical',
];

// Comprehensive Indian states, union territories & major hubs dictionary for location extraction
const INDIAN_LOCATIONS: { keyword: string; state: string; lat: number; lng: number }[] = [
  // Madhya Pradesh
  { keyword: 'madhya pradesh', state: 'Madhya Pradesh', lat: 22.9734, lng: 78.6569 },
  { keyword: 'bhopal', state: 'Madhya Pradesh', lat: 23.2599, lng: 77.4126 },
  { keyword: 'indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577 },
  { keyword: 'jabalpur', state: 'Madhya Pradesh', lat: 23.1815, lng: 79.9864 },
  { keyword: 'gwalior', state: 'Madhya Pradesh', lat: 26.2183, lng: 78.1784 },
  { keyword: 'ujjain', state: 'Madhya Pradesh', lat: 23.1765, lng: 75.7885 },

  // Uttar Pradesh
  { keyword: 'uttar pradesh', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
  { keyword: 'lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
  { keyword: 'kanpur', state: 'Uttar Pradesh', lat: 26.4499, lng: 80.3319 },
  { keyword: 'varanasi', state: 'Uttar Pradesh', lat: 25.3176, lng: 82.9739 },
  { keyword: 'agra', state: 'Uttar Pradesh', lat: 27.1767, lng: 78.0081 },
  { keyword: 'noida', state: 'Uttar Pradesh', lat: 28.5355, lng: 77.3910 },
  { keyword: 'prayagraj', state: 'Uttar Pradesh', lat: 25.4358, lng: 81.8463 },

  // Delhi NCR
  { keyword: 'delhi', state: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { keyword: 'new delhi', state: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { keyword: 'gurugram', state: 'Haryana', lat: 28.4595, lng: 77.0266 },
  { keyword: 'gurgaon', state: 'Haryana', lat: 28.4595, lng: 77.0266 },

  // Kerala
  { keyword: 'kerala', state: 'Kerala', lat: 10.8505, lng: 76.2711 },
  { keyword: 'kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673 },
  { keyword: 'wayanad', state: 'Kerala', lat: 11.5304, lng: 76.1306 },
  { keyword: 'thrissur', state: 'Kerala', lat: 10.5276, lng: 76.2144 },
  { keyword: 'trivandrum', state: 'Kerala', lat: 8.5241, lng: 76.9366 },
  { keyword: 'thiruvananthapuram', state: 'Kerala', lat: 8.5241, lng: 76.9366 },

  // Assam & Northeast
  { keyword: 'assam', state: 'Assam', lat: 26.2006, lng: 92.9376 },
  { keyword: 'guwahati', state: 'Assam', lat: 26.1445, lng: 91.7362 },
  { keyword: 'majuli', state: 'Assam', lat: 26.9500, lng: 94.1667 },
  { keyword: 'silchar', state: 'Assam', lat: 24.8333, lng: 92.7789 },
  { keyword: 'meghalaya', state: 'Meghalaya', lat: 25.4670, lng: 91.3662 },
  { keyword: 'shillong', state: 'Meghalaya', lat: 25.5788, lng: 91.8933 },

  // Odisha
  { keyword: 'odisha', state: 'Odisha', lat: 20.9517, lng: 85.0985 },
  { keyword: 'puri', state: 'Odisha', lat: 19.8135, lng: 85.8312 },
  { keyword: 'bhubaneswar', state: 'Odisha', lat: 20.2961, lng: 85.8245 },

  // Uttarakhand & Himachal
  { keyword: 'uttarakhand', state: 'Uttarakhand', lat: 30.0668, lng: 79.0193 },
  { keyword: 'himachal', state: 'Himachal Pradesh', lat: 31.1048, lng: 77.1734 },
  { keyword: 'shimla', state: 'Himachal Pradesh', lat: 31.1048, lng: 77.1734 },

  // Gujarat
  { keyword: 'gujarat', state: 'Gujarat', lat: 22.2587, lng: 71.1924 },
  { keyword: 'surat', state: 'Gujarat', lat: 21.1702, lng: 72.8311 },
  { keyword: 'ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },

  // Tamil Nadu & Maharashtra
  { keyword: 'tamil nadu', state: 'Tamil Nadu', lat: 11.1271, lng: 78.6569 },
  { keyword: 'chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { keyword: 'maharashtra', state: 'Maharashtra', lat: 19.7515, lng: 75.7139 },
  { keyword: 'mumbai', state: 'Maharashtra', lat: 18.9600, lng: 72.8300 },
];

/**
 * Strips HTML tags and unescapes HTML entities from text strings
 */
export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Explicit Non-Disaster / Political / Protest / Foreign Rejection.
// SINGLE SOURCE OF TRUTH: src/lib/clustering.ts's isDisasterTopic() re-checks against this same
// list at cluster time (a second, lighter safety net after this function's fuller ingest-time
// check) — it imports FORBIDDEN_TERMS from here rather than keeping its own copy, after the two
// drifted out of sync once already (see CLAUDE.md Investigation Log).
export const FORBIDDEN_TERMS = [
  'teacher', 'assignment', 'school enrolment', 'udise+', 'student enrollment',
  'protest', 'lathi-charge', 'lathi', 'protesters', 'assembly march', 'demonstration',
  'cricket', 'ipl', 'bollywood', 'movie', 'actor', 'actress', 'box office',
  'election', 'political party', 'speech', 'modi vs', 'rahul gandhi', 'bjp', 'congress',
  'hindutva', 'ideologue', 'mcbroom', 'spider-man', 'controversy', 'land dispute', 'firing along',
  'stock market', 'sensex', 'nifty', 'share price', 'crypto', 'iphone', 'gadget', 'smartphone',
  'gaza', 'israel', 'netanyahu', 'hamas', 'russia', 'ukraine', 'kharkiv', 'odesa',
  'moldova', 'florida', 'california', 'hawaii', 'naalehu', 'alaska', 'beijing', 'taiwan', 'trump', 'biden',
  'nws', 'flashfloodwarning', '#inwx', '#ffw', 'lake, in', 'porter, in', 'indiana',
  'denmark', 'skjern', 'hoboken', 'resiliencity', 'national coastline zone', 'central command zone',
  // Violent crime / assassination-adjacent stories legitimately mention 'hospital', 'injured',
  // 'critical condition' etc. — the same words genuine disaster medical-emergency reports use —
  // so they were passing classifyCategory('medical') despite not being a disaster (see CLAUDE.md
  // Investigation Log 2026-08-16, the "attacker... kirpan" false positive).
  'attacker', 'assassination', 'assassin', 'gunman', 'stabbed', 'stabbing', 'kirpan attack',
  'shot at', 'shooting incident', 'murder', 'homicide',
  // Accidental-firearm-discharge stories ("flyer's gun goes off at airport") legitimately
  // mention 'injured'/'security staff' — passed classifyCategory('medical') the same way the
  // "attacker... kirpan" case did above, despite being a security incident, not a disaster
  // dispatch (see CLAUDE.md Investigation Log 2026-08-16, fourth entry).
  'gun went off', 'gun goes off', 'accidental discharge', 'accidentally discharged',
  'weapon discharge', 'firearm discharge',
  // Financial-crime/investigation stories can trip the cyclone category's 'storm' keyword via
  // idiomatic use ("a storm of hype") rather than an actual weather event (see CLAUDE.md
  // Investigation Log 2026-08-16, fifth/sixth entries — the "GST evasion probe into Messi..."
  // false positive). 'storm of hype' guards the idiom directly; the GST/investigation terms
  // guard the story's real (non-disaster) subject so this doesn't become word-for-word
  // whack-a-mole against every other idiom containing 'storm'.
  'storm of hype', 'gst evasion', 'tax evasion', 'anti-corruption enquiry', 'corruption probe',
  // Political-rhetoric idiom: opposition figures describing a government/law-and-order failure
  // as a "complete collapse" trips the building_collapse category the same way "storm of hype"
  // tripped cyclone above (see CLAUDE.md Investigation Log 2026-08-16, eighth entry — the
  // "'Complete collapse': Tejashwi announces Raj Bhavan march..." false positive). Deliberately
  // does NOT include the bare phrase 'complete collapse' — a genuine building-collapse report
  // ("Complete collapse of 3-story building in Mumbai") legitimately uses that exact wording, so
  // blocking it would create false negatives on real disasters. Guards via the specific
  // politician/venue instead, which a real structural-collapse report would never mention.
  'tejashwi', 'raj bhavan march',
  // A single real-world incident (a passenger's licensed pistol accidentally discharging at
  // Varanasi airport, injuring 2 screeners) generated a wave of follow-up articles over several
  // days, each phrased differently enough to dodge the fourth entry's original guard terms
  // ('gun went off'/'gun goes off' didn't match "gun going off"; "accidental firing" and
  // "airport firing" weren't covered at all). See CLAUDE.md Investigation Log 2026-08-16, ninth
  // entry. Adding the specific recurring phrasings/venue markers rather than broadening to bare
  // 'firing', which would be far too aggressive (could match legitimate disaster-response terms).
  'gun going off', 'accidental firing', 'airport firing', 'screeners', 'aaiclas',
  // Attack/assassination-attempt follow-up story using different wording than the existing
  // 'assassination'/'attacker'/'shot at' guards (see first entry) — a political leader's
  // hospital discharge update, not a natural/civil disaster.
  'nanded attack', 'sukhbir',
  // Crime story (extortion attempt, arson as intimidation) — 'fire' keyword collision via "Car
  // Set on Fire", not an accidental/natural fire.
  'extortion',
  // Pollution/air-quality-index stories can trip the flood category's 'monsoon rain' keyword
  // (rain washing pollutants away is reported as an AQI improvement, not a flood) — narrow to
  // the AQI-specific acronym rather than touching 'monsoon rain', which is a legitimate flood
  // signal in the vast majority of real flood dispatches.
  'aqi',
  // Viral/human-interest story marker — "man cooks omelette in heatwave, netizens shocked" is
  // entertainment content, not an actionable heatwave disaster dispatch, despite matching the
  // medical category's 'heatwave' keyword.
  'netizens shocked',
  // Social-media marketplace listings ("#Cyclone single-speed for Negotiable price on Sprocket
  // in #Amritsar") collide with the cyclone category via a bicycle model/brand name literally
  // called "Cyclone" — a real Mastodon post found during testing, not hypothetical. Guards via
  // the marketplace-listing markers rather than touching the 'cyclone' keyword itself.
  'sprocketapp', 'single-speed', 'negotiable price'
];

/**
 * Strict India Disaster Validator: Ensures news is BOTH a genuine disaster AND India-centric
 */
export function isStrictIndiaDisaster(headline: string, description: string): boolean {
  const cleanedHeadline = cleanText(headline);
  const cleanedDesc = cleanText(description);
  const fullText = `${cleanedHeadline} ${cleanedDesc}`.toLowerCase();

  // 1. Explicit Non-Disaster / Political / Protest / Foreign Rejection
  if (FORBIDDEN_TERMS.some((term) => containsKeyword(fullText, term))) {
    return false;
  }

  // 2. Disaster Category Check
  const category = classifyCategory(fullText);
  if (!category) {
    return false;
  }

  // 3. Must match an explicit Indian location or mention India/NDRF/SDRF/Indian agencies.
  // NOTE: 'up' (Uttar Pradesh) and 'met' (IMD) were previously in this list as bare .includes()
  // checks — both are common English substrings ("erupt", "disrupted", "sometimes", "met with"),
  // so they made this check pass for almost any English disaster text regardless of country.
  // Full "uttar pradesh" is already covered via INDIAN_LOCATIONS below; 'imd' covers the IMD case.
  const matchesIndianLocation = INDIAN_LOCATIONS.some((loc) => containsKeyword(fullText, loc.keyword));
  const indiaAgencyTerms = ['india', 'indian', 'ndrf', 'sdrf', 'ksdma', 'asdma', 'osdma', 'imd', 'kerala', 'assam', 'delhi', 'mumbai', 'gujarat', 'bihar', 'himachal', 'uttarakhand'];
  const hasExplicitIndiaAgency = indiaAgencyTerms.some((term) => containsKeyword(fullText, term));

  if (!matchesIndianLocation && !hasExplicitIndiaAgency) {
    return false;
  }

  return true;
}

export function isIndiaRelated(text: string): boolean {
  return isStrictIndiaDisaster(text, '');
}

/**
 * Categorize headline + text into a Disaster Category
 */
export function classifyCategory(text: string): CategoryType | null {
  const lower = text.toLowerCase();

  for (const cat of CATEGORY_CHECK_ORDER) {
    if (CATEGORY_KEYWORDS[cat].some((kw) => containsKeyword(lower, kw))) {
      return cat;
    }
  }

  return null;
}

/**
 * Infer severity based on urgency terms
 */
export function inferSeverity(text: string): SeverityLevel {
  const lower = text.toLowerCase();

  const criticalTerms = ['critical', 'fatal', 'trapped', 'evacuating', 'massive', 'emergency', 'dead', 'devastating', 'danger mark', 'red alert'];
  if (criticalTerms.some((term) => containsKeyword(lower, term))) {
    return 'critical';
  }

  const highTerms = ['high', 'severe', 'warning', 'alert', 'disrupted', 'submerged', 'orange alert', 'waterlogging'];
  if (highTerms.some((term) => containsKeyword(lower, term))) {
    return 'high';
  }

  const moderateTerms = ['moderate', 'minor', 'rising'];
  if (moderateTerms.some((term) => containsKeyword(lower, term))) {
    return 'moderate';
  }

  return 'low';
}

/**
 * Match text against known Indian locations
 */
export function extractLocation(text: string): LocationInfo {
  const lower = text.toLowerCase();

  for (const loc of INDIAN_LOCATIONS) {
    if (containsKeyword(lower, loc.keyword)) {
      return {
        lat: loc.lat,
        lng: loc.lng,
        placeName: loc.keyword.charAt(0).toUpperCase() + loc.keyword.slice(1),
        state: loc.state,
      };
    }
  }

  if (containsKeyword(lower, 'madhya pradesh') || containsKeyword(lower, 'm.p.')) return { lat: 22.9734, lng: 78.6569, placeName: 'Madhya Pradesh Sector', state: 'Madhya Pradesh' };
  if (containsKeyword(lower, 'uttar pradesh') || containsKeyword(lower, 'u.p.')) return { lat: 26.8467, lng: 80.9462, placeName: 'Uttar Pradesh Sector', state: 'Uttar Pradesh' };
  if (containsKeyword(lower, 'himachal pradesh') || containsKeyword(lower, 'h.p.')) return { lat: 31.1048, lng: 77.1734, placeName: 'Himachal Pradesh Sector', state: 'Himachal Pradesh' };
  if (containsKeyword(lower, 'arunachal pradesh')) return { lat: 28.2180, lng: 94.7278, placeName: 'Arunachal Sector', state: 'Arunachal Pradesh' };
  if (containsKeyword(lower, 'andhra pradesh')) return { lat: 15.9129, lng: 79.7400, placeName: 'Andhra Sector', state: 'Andhra Pradesh' };

  return {
    lat: 20.5937,
    lng: 78.9629,
    placeName: 'Central Command Zone',
    state: 'Madhya Pradesh',
  };
}

export function calculateCredibility(source: ReportSource): number {
  switch (source.type) {
    case 'official':
      return 95 + Math.floor(Math.random() * 5);
    case 'news':
      return 80 + Math.floor(Math.random() * 12);
    case 'sensor':
      return 90 + Math.floor(Math.random() * 8);
    case 'social':
      return 55 + Math.floor(Math.random() * 20);
    case 'citizen':
      return 60 + Math.floor(Math.random() * 20);
    default:
      return 70;
  }
}
