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
// containsKeyword matches whole words only (see its docstring), so a keyword list that only has
// the singular form silently drops any headline using the plural — a very common headline
// pattern ("Assam floods:", "Earthquakes rattle...", "Landslides block highway...") that was
// classifying as `null` (no category) and getting the report dropped entirely rather than
// merely misclassified, since aggregate.ts/rssAdapter.ts both require a non-null category to
// keep a report. Found via a real "Assam floods: NDRF rescues..." headline that returned `null`
// despite unambiguously being a flood report. Added the plural form of every keyword whose
// singular/plural pair are both plausible in real headlines (not e.g. 'seismic', which has no
// natural plural).
const CATEGORY_KEYWORDS: Record<CategoryType, string[]> = {
  flood: [
    'flood', 'floods', 'flooding', 'flooded', 'floodwater', 'floodwaters', 'inundation',
    'waterlogging', 'waterlogged', 'submerged', 'overflow', 'overflowing', 'brahmaputra',
    'ganga', 'yamuna', 'storm surge', 'tidal surge', 'sea surge', 'water surge', 'river surge',
    'deluge', 'drowning', 'drowned', 'heavy rain', 'heavy rainfall',
    'rivers rise', 'danger mark', 'downpour', 'monsoon rain', 'torrents', 'dam opened',
    'sluice gates', 'inundated', 'water level', 'rain alert', 'rains', 'waterlogging in'
  ],
  fire: [
    'fire', 'fires', 'wildfire', 'wildfires', 'bushfire', 'bushfires', 'blaze', 'blazes',
    'blazing', 'explosion', 'explosions', 'flames', 'chemical leak', 'inferno', 'combustion',
    'smoke', 'gas leak', 'toxic fumes', 'firefighters', 'fire tender'
  ],
  earthquake: [
    'earthquake', 'earthquakes', 'tremor', 'tremors', 'quake', 'quakes', 'seismic', 'epicenter',
    'aftershock', 'aftershocks', 'faultline', 'magnitude', 'seismograph'
  ],
  cyclone: [
    'cyclone', 'cyclones', 'storm', 'storms', 'typhoon', 'typhoons', 'hurricane', 'hurricanes',
    'landfall', 'squall', 'squalls', 'gale', 'gales', 'bay of bengal', 'deep depression',
    'weather depression', 'met forecasts', 'red alert', 'orange alert', 'imd warns',
    'weather alert', 'cyclonic storm'
  ],
  building_collapse: [
    'collapse', 'collapses', 'collapsed', 'collapsing', 'rubble', 'structural failure',
    'cave-in', 'building fell', 'masonry', 'wall collapsed', 'bridge collapse',
    'house collapsed', 'structure collapse'
  ],
  medical: [
    'medical emergency', 'trauma', 'epidemic', 'epidemics', 'heatwave', 'heatwaves', 'casualty',
    'casualties', 'dengue', 'cholera', 'ambulance', 'hospital', 'hospitals', 'injured',
    'drowned', 'drowning', 'fatalities', 'rescued', 'heat stroke', 'outbreak', 'outbreaks',
    'poisoning'
  ],
  landslide: [
    'landslide', 'landslides', 'mudslide', 'mudslides', 'cloudburst', 'cloudbursts', 'rockfall',
    'rockfalls', 'debris flow', 'sludge', 'boulder fall', 'earthmover', 'blocked by landslide',
    'road blocked'
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
// building_collapse checked before fire for the same reason: a genuine tunnel/structure collapse
// caused by a gas explosion ("Sikkim tunnel collapse: ...tunnel collapsed following an explosion
// suspected to be from methane gas") legitimately mentions 'explosion', a fire-category keyword,
// as a body-text detail about the cause — but the actual event, named explicitly in the
// headline, is a structural collapse. A pure fire/explosion story with no collapse keyword still
// correctly matches 'fire'.
const CATEGORY_CHECK_ORDER: CategoryType[] = [
  'flood', 'building_collapse', 'fire', 'earthquake', 'cyclone', 'landslide', 'medical',
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

  // Added: roughly a third of India's states/UTs had NO entry here at all, so any report about
  // them (a specific city/district not separately matched either) fell through to
  // extractLocation()'s generic fallback ('Central Command Zone') — which server/db.ts's
  // purgeInvalidClusters() then hard-deletes as junk data on every pipeline run, since that
  // placeholder is also used for genuinely non-India/malformed records. In practice this meant
  // real disaster reports about these states were silently vanishing from the dev database every
  // 3-minute cycle — found via a real Bihar temple stampede story (Ashok Dham, Lakhisarai) that
  // kept being fetched and correctly classified, but never survived to the API response.

  // Bihar
  { keyword: 'bihar', state: 'Bihar', lat: 25.0961, lng: 85.3131 },
  { keyword: 'patna', state: 'Bihar', lat: 25.5941, lng: 85.1376 },
  { keyword: 'lakhisarai', state: 'Bihar', lat: 25.1717, lng: 86.0958 },
  { keyword: 'gaya', state: 'Bihar', lat: 24.7955, lng: 84.9994 },
  { keyword: 'muzaffarpur', state: 'Bihar', lat: 26.1225, lng: 85.3906 },
  { keyword: 'darbhanga', state: 'Bihar', lat: 26.1542, lng: 85.8918 },

  // West Bengal
  { keyword: 'west bengal', state: 'West Bengal', lat: 22.9868, lng: 87.8550 },
  { keyword: 'kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { keyword: 'darjeeling', state: 'West Bengal', lat: 27.0410, lng: 88.2663 },
  { keyword: 'siliguri', state: 'West Bengal', lat: 26.7271, lng: 88.3953 },
  { keyword: 'howrah', state: 'West Bengal', lat: 22.5958, lng: 88.2636 },

  // Karnataka
  { keyword: 'karnataka', state: 'Karnataka', lat: 15.3173, lng: 75.7139 },
  { keyword: 'bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { keyword: 'bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { keyword: 'mangalore', state: 'Karnataka', lat: 12.9141, lng: 74.8560 },

  // Punjab & Chandigarh
  { keyword: 'punjab', state: 'Punjab', lat: 31.1471, lng: 75.3412 },
  { keyword: 'amritsar', state: 'Punjab', lat: 31.6340, lng: 74.8723 },
  { keyword: 'ludhiana', state: 'Punjab', lat: 30.9010, lng: 75.8573 },
  { keyword: 'chandigarh', state: 'Chandigarh', lat: 30.7333, lng: 76.7794 },

  // Rajasthan
  { keyword: 'rajasthan', state: 'Rajasthan', lat: 27.0238, lng: 74.2179 },
  { keyword: 'jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  { keyword: 'jodhpur', state: 'Rajasthan', lat: 26.2389, lng: 73.0243 },

  // Telangana
  { keyword: 'telangana', state: 'Telangana', lat: 18.1124, lng: 79.0193 },
  { keyword: 'hyderabad', state: 'Telangana', lat: 17.3850, lng: 78.4867 },

  // Jharkhand
  { keyword: 'jharkhand', state: 'Jharkhand', lat: 23.6102, lng: 85.2799 },
  { keyword: 'ranchi', state: 'Jharkhand', lat: 23.3441, lng: 85.3096 },
  { keyword: 'jamshedpur', state: 'Jharkhand', lat: 22.8046, lng: 86.2029 },

  // Chhattisgarh
  { keyword: 'chhattisgarh', state: 'Chhattisgarh', lat: 21.2787, lng: 81.8661 },
  { keyword: 'raipur', state: 'Chhattisgarh', lat: 21.2514, lng: 81.6296 },

  // Goa
  { keyword: 'goa', state: 'Goa', lat: 15.2993, lng: 74.1240 },
  { keyword: 'panaji', state: 'Goa', lat: 15.4909, lng: 73.8278 },

  // Remaining Northeast states
  { keyword: 'manipur', state: 'Manipur', lat: 24.6637, lng: 93.9063 },
  { keyword: 'imphal', state: 'Manipur', lat: 24.8170, lng: 93.9368 },
  { keyword: 'mizoram', state: 'Mizoram', lat: 23.1645, lng: 92.9376 },
  { keyword: 'aizawl', state: 'Mizoram', lat: 23.7271, lng: 92.7176 },
  { keyword: 'nagaland', state: 'Nagaland', lat: 26.1584, lng: 94.5624 },
  { keyword: 'kohima', state: 'Nagaland', lat: 25.6751, lng: 94.1086 },
  { keyword: 'tripura', state: 'Tripura', lat: 23.9408, lng: 91.9882 },
  { keyword: 'agartala', state: 'Tripura', lat: 23.8315, lng: 91.2868 },
  { keyword: 'sikkim', state: 'Sikkim', lat: 27.5330, lng: 88.5122 },
  { keyword: 'gangtok', state: 'Sikkim', lat: 27.3389, lng: 88.6065 },
  // National-level stories that only name the Northeast region collectively ("flood management
  // projects in Northeast India") rather than a specific state also used to fall through to the
  // generic fallback and get purged as junk — same root cause as the missing states above.
  { keyword: 'northeast india', state: 'Assam', lat: 26.2006, lng: 92.9376 },
  { keyword: 'north east india', state: 'Assam', lat: 26.2006, lng: 92.9376 },
  { keyword: 'northeastern states', state: 'Assam', lat: 26.2006, lng: 92.9376 },

  // Jammu & Kashmir, Ladakh
  { keyword: 'jammu and kashmir', state: 'Jammu and Kashmir', lat: 33.7782, lng: 76.5762 },
  { keyword: 'jammu', state: 'Jammu and Kashmir', lat: 32.7266, lng: 74.8570 },
  { keyword: 'kashmir', state: 'Jammu and Kashmir', lat: 34.0837, lng: 74.7973 },
  { keyword: 'srinagar', state: 'Jammu and Kashmir', lat: 34.0837, lng: 74.7973 },
  { keyword: 'ladakh', state: 'Ladakh', lat: 34.1526, lng: 77.5771 },
  { keyword: 'leh', state: 'Ladakh', lat: 34.1642, lng: 77.5847 },

  // Union Territories
  { keyword: 'puducherry', state: 'Puducherry', lat: 11.9416, lng: 79.8083 },
  { keyword: 'andaman', state: 'Andaman and Nicobar Islands', lat: 11.7401, lng: 92.6586 },
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
  // NOTE: this list used to also contain a broad set of generic non-disaster-*topic* words —
  // 'teacher'/'assignment'/'school enrolment'/'udise+'/'student enrollment', 'protest'/
  // 'lathi-charge'/'lathi'/'protesters'/'assembly march'/'demonstration', 'cricket'/'ipl'/
  // 'bollywood'/'movie'/'actor'/'actress'/'box office', 'election'/'political party'/'speech'/
  // 'modi vs'/'rahul gandhi'/'bjp'/'congress'/'hindutva'/'ideologue'/'controversy', 'stock
  // market'/'sensex'/'nifty'/'share price'/'crypto'/'iphone'/'gadget'/'smartphone', and 'land
  // dispute'. All removed (2026-08-17) after testing showed they were dropping real disaster
  // reports wholesale, not just filtering unrelated content: e.g. "Assam floods: CM ... of BJP
  // visits relief camp", "Bollywood actor donates Rs 1 crore to Kerala flood relief fund",
  // "Cricket match postponed as Mumbai floods disrupt stadium access", "Flood victims protest
  // against inadequate relief distribution in Bihar", "Stock market falls as Mumbai floods
  // disrupt banking operations" — all genuine, classifyCategory-confirmed disaster headlines,
  // all silently dropped. A politician responding to a disaster, a celebrity donating to relief,
  // a sports event being disrupted, or disaster survivors protesting inadequate relief are all
  // extremely common REAL disaster-news patterns in India, not signals of irrelevance. Testing
  // also confirmed these terms added no unique protective value against the pure non-disaster
  // stories they were presumably meant to catch (pure election/protest/cricket coverage) — those
  // already return a null category on their own, since they don't contain any real
  // CATEGORY_KEYWORDS term to begin with. The one real risk these blanket terms *did* guard
  // against — English idioms that borrow a disaster word ("landslide victory", "political
  // storm", "flood of votes") — is now guarded via the specific idiom phrases below instead,
  // which only fire on the idiom itself, not on any mention of the topic.
  'landslide victory', 'landslide win', 'election landslide', 'political storm',
  'electoral storm', 'political earthquake', 'earthquake in the political',
  'earthquake in political', 'flood of votes',
  'mcbroom', 'spider-man', 'firing along',
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
  'fires during security check',
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
  'sprocketapp', 'single-speed', 'negotiable price',
  // Personal-life human-interest story ("She May Smoke Weed, Have Relationships With Other
  // Men...") trips the fire category's 'smoke' keyword. Guarded via the specific phrase rather
  // than touching 'smoke' itself, which is a legitimate signal in real fire/toxic-fume reports.
  'smoke weed',
  // "Kerala's baby cradle scheme hits milestone: 1,000th infant rescued" — a child-welfare
  // program human-interest story, not a disaster — trips the medical category's 'rescued'
  // keyword. Guarded via the specific scheme name rather than touching 'rescued', which is a
  // legitimate signal in real flood/collapse/landslide rescue-operation reports.
  'cradle scheme',
  // Road traffic accidents ("Speeding Scooter Kills 65-Year-Old Watchman") trip the medical
  // category's 'killed'/'injured' keywords the same way violent-crime stories do (see the
  // 'attacker'/'shot at' guards above) despite being routine traffic incidents, not a disaster
  // dispatch. Guarded via the vehicle-speed marker rather than touching 'killed'/'injured'.
  'speeding scooter', 'speeding car', 'speeding bike', 'speeding truck', 'speeding bus',
  // Legal/compensation follow-up stories about old road accidents ("Rs 2.92 Crore Compensation
  // For Man Disabled In 2020 Delhi Road Accident") aren't a live disaster dispatch, but their
  // description text incidentally matches the medical category. Guarded via the compensation
  // marker, which a genuine disaster report would not use.
  'crore compensation',
  // A horrific crime story ("Man Stops On Bridge For Selfie With Infant Daughter, Throws Her
  // Into Yamuna") trips the flood category via the river name 'yamuna' — a real false positive
  // found on the live feed. Guarded via the act itself rather than touching 'yamuna', which is a
  // legitimate signal in real Yamuna flood-level reports.
  'throws her into', 'threw her into', 'throws him into', 'threw him into',
  // A meta/policy article about India's disaster-response track record ("India emerging as
  // leading responder to natural disasters worldwide: Report") is disaster-adjacent commentary,
  // not a live incident dispatch — its body text cites past disasters by name, which incidentally
  // matches a category keyword. Guarded via the specific framing phrase.
  'leading responder to natural disasters',
  // Idiomatic figurative use of "outbreak"/"epidemic" (an "outbreak of violence/clashes/
  // fighting" is a sudden onset of conflict, not a disease outbreak) trips the medical
  // category's 'outbreak'/'epidemic' keywords. Guarded via the specific idiom rather than
  // touching 'outbreak'/'epidemic' themselves, which are legitimate signals in real
  // disease-outbreak disaster reports.
  'outbreak of violence', 'outbreak of clashes', 'outbreak of fighting', 'epidemic of fake news',
  // Financial/business idiom ("income from central rights collapsed" — Tata Steel Jamshedpur FC
  // revenue reporting) trips the building_collapse category's 'collapsed' keyword the same way
  // "storm of hype"/"landslide victory" trip other categories. Guarded via the specific
  // financial-metric phrasing rather than touching 'collapsed' itself, which is the single most
  // important signal in real structural-collapse disaster reports.
  'revenue collapsed', 'income collapsed', 'earnings collapsed', 'rights collapsed',
  'sales collapsed', 'stock collapsed', 'shares collapsed',
  // A botany/nature feature ("Akur-chi-bhaji and the Ancient Mysteries of Ferns") mentioning
  // that ferns "absorb the monsoon rains" trips the flood category's 'monsoon rain' keyword
  // despite being entertainment/science content, not disaster reporting. Guarded via markers
  // specific to this kind of plant-science feature rather than touching 'monsoon rain', which is
  // one of the most reliable signals in real flood dispatches.
  'chromosomes', 'spores',
  // Batch found 2026-08-21 while adding the Gemini isGenuineDisaster gate (see
  // server/services/aiClassifier.ts) — these are a stopgap rule-based safety net for when Gemini
  // is unavailable/quota-exhausted (a real, recurring condition — see CLAUDE.md Investigation
  // Log), not a replacement for it. Each verified both directions: blocks the false positive
  // below, a battery of real disaster headlines already in the live feed still pass.
  //
  // Obituary/celebrity-death stories mention "hospital"/"medical care" like a real medical
  // emergency does ("Veteran actor Sowcar Janaki died in Chennai... admitted to a private
  // hospital... receiving intensive medical care").
  'age-related health issues',
  // Political-controversy story about a crowd-control-weapon (pellet gun) row — not a disaster
  // dispatch, despite classifyCategory('medical') matching on 'injured'/'fire'.
  'pellet gun row',
  // Assassination-attempt-gone-wrong crime story ("2 shooters on way to kill Delhi doctor landed
  // in a hospital") — trips 'medical' via 'hospital', not an emergency dispatch.
  'on way to kill',
  // "Yudh Abhyas" is a recurring named India-US joint military exercise — trips the 'fire'
  // category via "precision fires" (the military term for live-fire training), not a wildfire or
  // structural fire.
  'yudh abhyas',
  // Commendation/award-ceremony story about a past, already-resolved incident (a bomb-detection
  // dog honored for a blast response months earlier) — not a live dispatch.
  'gets army award',
  // Banned-kite-string (a throat/skin-cutting hazard) injury + seizure story — a public-safety
  // regulatory item, not a disaster.
  'chinese manjha',
  // Human-trafficking crime story — trips 'medical' via 'hospitals' (where the traffickers
  // operated), not a medical emergency.
  'trafficking racket',
  // Recurring daily "will schools remain closed" content-mill template — published every day
  // regardless of whether an actual disaster is occurring, distinct from a genuine disaster-
  // driven closure headline like "Schools shut in 3 Odisha districts amid heavy rainfall" (which
  // still correctly passes — this guard only matches the specific forecast-checker phrasing).
  'will schools remain closed',
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

  // Bare 'high' used to inflate severity via completely unrelated mentions — "Delhi High Court
  // dismisses flood compensation case" (a routine legal story, still a genuine disaster report
  // overall since it mentions a real flood) got tagged HIGH severity purely because of "High
  // Court". Narrowed to specific severity-signaling phrases instead.
  const highTerms = ['high alert', 'high risk', 'highly affected', 'severe', 'warning', 'alert', 'disrupted', 'submerged', 'orange alert', 'waterlogging'];
  if (highTerms.some((term) => containsKeyword(lower, term))) {
    return 'high';
  }

  const moderateTerms = ['moderate', 'minor', 'rising'];
  if (moderateTerms.some((term) => containsKeyword(lower, term))) {
    return 'moderate';
  }

  return 'low';
}

// "Pradesh" states whose plain name isn't its own INDIAN_LOCATIONS entry (their districts/cities
// are instead). Kept in the same positional race as INDIAN_LOCATIONS below — see extractLocation.
const PRADESH_FALLBACKS: { keywords: string[]; loc: LocationInfo }[] = [
  { keywords: ['madhya pradesh', 'm.p.'], loc: { lat: 22.9734, lng: 78.6569, placeName: 'Madhya Pradesh Sector', state: 'Madhya Pradesh' } },
  { keywords: ['uttar pradesh', 'u.p.'], loc: { lat: 26.8467, lng: 80.9462, placeName: 'Uttar Pradesh Sector', state: 'Uttar Pradesh' } },
  { keywords: ['himachal pradesh', 'h.p.'], loc: { lat: 31.1048, lng: 77.1734, placeName: 'Himachal Pradesh Sector', state: 'Himachal Pradesh' } },
  { keywords: ['arunachal pradesh'], loc: { lat: 28.2180, lng: 94.7278, placeName: 'Arunachal Sector', state: 'Arunachal Pradesh' } },
  { keywords: ['andhra pradesh'], loc: { lat: 15.9129, lng: 79.7400, placeName: 'Andhra Sector', state: 'Andhra Pradesh' } },
];

/**
 * Match text against known Indian locations.
 *
 * Picks whichever candidate keyword occurs EARLIEST IN THE TEXT, not the first one to appear in
 * INDIAN_LOCATIONS' declaration order. The previous array-order approach meant a headline like
 * "Kerala geologist died in Sikkim tunnel collapse" extracted 'Kerala' (the victim's home state,
 * incidentally listed earlier in the array) instead of 'Sikkim' (where the disaster actually
 * happened, the real story) — because `.find()`/`.some()` over the array stops at the first
 * *array* entry that matches, regardless of where in the text it occurs. Real-world headlines
 * often name a secondary state (a victim's or worker's home state) alongside the actual incident
 * location, so array order was silently picking the wrong one whenever the secondary state
 * happened to sort earlier in this file.
 *
 * PRADESH_FALLBACKS is raced in the SAME positional comparison as INDIAN_LOCATIONS, not checked
 * only as an all-or-nothing last resort after it. The last-resort version had a real bug: a wire
 * story headlined "Arunachal Pradesh flash floods: Four killed..." with a "NEW DELHI:" byline in
 * its body (standard PTI/TOI wire-service dateline format — where the story was FILED from, not
 * where the disaster happened) always extracted 'Delhi', because 'Delhi' is an INDIAN_LOCATIONS
 * entry and 'Arunachal Pradesh' was not — so the fallback list was never even consulted, no
 * matter how much earlier 'Arunachal Pradesh' appeared in the actual text. Found while
 * investigating a real disaster (Arunachal flash flood, 4 dead) that had been silently merged
 * into an unrelated "Delhi weather forecast" incident cluster. See CLAUDE.md Investigation Log.
 */
export function extractLocation(text: string): LocationInfo {
  const lower = text.toLowerCase();

  let best: { loc: LocationInfo; index: number } | null = null;

  for (const loc of INDIAN_LOCATIONS) {
    const match = buildKeywordRegex(loc.keyword).exec(lower);
    if (match && (best === null || match.index < best.index)) {
      best = {
        loc: {
          lat: loc.lat,
          lng: loc.lng,
          placeName: loc.keyword.charAt(0).toUpperCase() + loc.keyword.slice(1),
          state: loc.state,
        },
        index: match.index,
      };
    }
  }

  for (const { keywords, loc } of PRADESH_FALLBACKS) {
    for (const kw of keywords) {
      const match = buildKeywordRegex(kw).exec(lower);
      if (match && (best === null || match.index < best.index)) {
        best = { loc, index: match.index };
      }
    }
  }

  if (best) return best.loc;

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
