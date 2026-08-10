import type { CategoryType, SeverityLevel, LocationInfo, ReportSource } from '../src/types/incident';

// Keywords dictionary for category classification
const CATEGORY_KEYWORDS: Record<CategoryType, string[]> = {
  flood: ['flood', 'inundation', 'waterlogging', 'submerged', 'overflow', 'overflowing', 'brahmaputra', 'surge', 'deluge', 'drowning'],
  fire: ['fire', 'blaze', 'explosion', 'flames', 'chemical leak', 'inferno', 'combustion'],
  earthquake: ['earthquake', 'tremor', 'quake', 'seismic', 'epicenter', 'aftershock', 'faultline', 'magnitude'],
  cyclone: ['cyclone', 'storm', 'typhoon', 'hurricane', 'landfall', 'squall', 'gale', 'bay of bengal', 'depresssion'],
  building_collapse: ['collapse', 'collapsed', 'rubble', 'structural failure', 'cave-in', 'building fell', 'masonry'],
  medical: ['medical emergency', 'trauma', 'epidemic', 'heatwave', 'casualty', 'dengue', 'cholera', 'ambulance', 'hospital'],
  landslide: ['landslide', 'mudslide', 'cloudburst', 'rockfall', 'debris flow', 'sludge', 'boulder fall'],
};

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
  { keyword: 'manipur', state: 'Manipur', lat: 24.6637, lng: 93.9063 },
  { keyword: 'imphal', state: 'Manipur', lat: 24.8170, lng: 93.9368 },
  { keyword: 'tripura', state: 'Tripura', lat: 23.9408, lng: 91.9882 },
  { keyword: 'agartala', state: 'Tripura', lat: 23.8315, lng: 91.2868 },
  { keyword: 'sikkim', state: 'Sikkim', lat: 27.5330, lng: 88.5122 },
  { keyword: 'gangtok', state: 'Sikkim', lat: 27.3389, lng: 88.6065 },
  { keyword: 'nagaland', state: 'Nagaland', lat: 26.1584, lng: 94.5624 },
  { keyword: 'mizoram', state: 'Mizoram', lat: 23.1645, lng: 92.9376 },
  { keyword: 'arunachal', state: 'Arunachal Pradesh', lat: 28.2180, lng: 94.7278 },

  // Odisha
  { keyword: 'odisha', state: 'Odisha', lat: 20.9517, lng: 85.0985 },
  { keyword: 'puri', state: 'Odisha', lat: 19.8135, lng: 85.8312 },
  { keyword: 'paradeep', state: 'Odisha', lat: 20.2644, lng: 86.6645 },
  { keyword: 'bhubaneswar', state: 'Odisha', lat: 20.2961, lng: 85.8245 },
  { keyword: 'cuttack', state: 'Odisha', lat: 20.4625, lng: 85.8828 },

  // Uttarakhand & Himachal
  { keyword: 'uttarakhand', state: 'Uttarakhand', lat: 30.0668, lng: 79.0193 },
  { keyword: 'uttarkashi', state: 'Uttarakhand', lat: 30.7268, lng: 78.4354 },
  { keyword: 'chamoli', state: 'Uttarakhand', lat: 30.4042, lng: 79.3309 },
  { keyword: 'dehradun', state: 'Uttarakhand', lat: 30.3165, lng: 78.0322 },
  { keyword: 'himachal', state: 'Himachal Pradesh', lat: 31.1048, lng: 77.1734 },
  { keyword: 'shimla', state: 'Himachal Pradesh', lat: 31.1048, lng: 77.1734 },
  { keyword: 'dharamshala', state: 'Himachal Pradesh', lat: 32.2190, lng: 76.3234 },
  { keyword: 'manali', state: 'Himachal Pradesh', lat: 32.2432, lng: 77.1892 },

  // Gujarat
  { keyword: 'gujarat', state: 'Gujarat', lat: 22.2587, lng: 71.1924 },
  { keyword: 'surat', state: 'Gujarat', lat: 21.1702, lng: 72.8311 },
  { keyword: 'ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },
  { keyword: 'vadodara', state: 'Gujarat', lat: 22.3072, lng: 73.1812 },
  { keyword: 'bhuj', state: 'Gujarat', lat: 23.2420, lng: 69.6669 },

  // Tamil Nadu
  { keyword: 'tamil nadu', state: 'Tamil Nadu', lat: 11.1271, lng: 78.6569 },
  { keyword: 'chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { keyword: 'coimbatore', state: 'Tamil Nadu', lat: 11.0168, lng: 76.9558 },
  { keyword: 'madurai', state: 'Tamil Nadu', lat: 9.9252, lng: 78.1198 },

  // Maharashtra
  { keyword: 'maharashtra', state: 'Maharashtra', lat: 19.7515, lng: 75.7139 },
  { keyword: 'mumbai', state: 'Maharashtra', lat: 18.9600, lng: 72.8300 },
  { keyword: 'pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  { keyword: 'nagpur', state: 'Maharashtra', lat: 21.1458, lng: 79.0882 },
  { keyword: 'nashik', state: 'Maharashtra', lat: 20.0059, lng: 73.7898 },

  // Karnataka
  { keyword: 'karnataka', state: 'Karnataka', lat: 15.3173, lng: 75.7139 },
  { keyword: 'bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { keyword: 'bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { keyword: 'mangalore', state: 'Karnataka', lat: 12.9141, lng: 74.8560 },

  // Telangana & Andhra
  { keyword: 'telangana', state: 'Telangana', lat: 18.1124, lng: 79.0193 },
  { keyword: 'hyderabad', state: 'Telangana', lat: 17.3850, lng: 78.4867 },
  { keyword: 'andhra pradesh', state: 'Andhra Pradesh', lat: 15.9129, lng: 79.7400 },
  { keyword: 'visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lng: 83.2185 },
  { keyword: 'vijayawada', state: 'Andhra Pradesh', lat: 16.5062, lng: 80.6480 },

  // West Bengal & Bihar
  { keyword: 'west bengal', state: 'West Bengal', lat: 22.9868, lng: 87.8550 },
  { keyword: 'kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { keyword: 'siliguri', state: 'West Bengal', lat: 26.7271, lng: 88.3953 },
  { keyword: 'bihar', state: 'Bihar', lat: 25.0961, lng: 85.3131 },
  { keyword: 'patna', state: 'Bihar', lat: 25.6110, lng: 85.1440 },

  // Rajasthan & Punjab & Haryana
  { keyword: 'rajasthan', state: 'Rajasthan', lat: 27.0238, lng: 74.2179 },
  { keyword: 'jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  { keyword: 'jodhpur', state: 'Rajasthan', lat: 26.2389, lng: 73.0243 },
  { keyword: 'punjab', state: 'Punjab', lat: 31.1471, lng: 75.3412 },
  { keyword: 'amritsar', state: 'Punjab', lat: 31.6340, lng: 74.8723 },
  { keyword: 'ludhiana', state: 'Punjab', lat: 30.9010, lng: 75.8573 },
  { keyword: 'haryana', state: 'Haryana', lat: 29.0588, lng: 76.0856 },
  { keyword: 'gurugram', state: 'Haryana', lat: 28.4595, lng: 77.0266 },
  { keyword: 'gurgaon', state: 'Haryana', lat: 28.4595, lng: 77.0266 },

  // Jammu & Kashmir & Ladakh
  { keyword: 'jammu', state: 'Jammu & Kashmir', lat: 32.7266, lng: 74.8570 },
  { keyword: 'srinagar', state: 'Jammu & Kashmir', lat: 34.0837, lng: 74.7973 },
  { keyword: 'kashmir', state: 'Jammu & Kashmir', lat: 34.0837, lng: 74.7973 },
  { keyword: 'ladakh', state: 'Ladakh', lat: 34.1526, lng: 77.5771 },
  { keyword: 'leh', state: 'Ladakh', lat: 34.1526, lng: 77.5771 },

  // Jharkhand & Chhattisgarh & Goa
  { keyword: 'jharkhand', state: 'Jharkhand', lat: 23.6102, lng: 85.2799 },
  { keyword: 'ranchi', state: 'Jharkhand', lat: 23.3441, lng: 85.3096 },
  { keyword: 'chhattisgarh', state: 'Chhattisgarh', lat: 21.2787, lng: 81.8661 },
  { keyword: 'raipur', state: 'Chhattisgarh', lat: 21.2514, lng: 81.6296 },
  { keyword: 'goa', state: 'Goa', lat: 15.2993, lng: 74.1240 },
];

/**
 * Strips HTML tags and unescapes HTML entities from text strings
 */
export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<img[^>]*>/gi, '') // Remove <img ... />
    .replace(/<[^>]+>/g, '')     // Remove all HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strict India Disaster Validator: Ensures news is BOTH a genuine disaster AND India-centric
 */
export function isStrictIndiaDisaster(headline: string, description: string): boolean {
  const cleanedHeadline = cleanText(headline);
  const cleanedDesc = cleanText(description);
  const fullText = `${cleanedHeadline} ${cleanedDesc}`.toLowerCase();

  // 1. Explicit Non-Disaster / Political / Protest / Foreign Rejection
  const forbiddenTerms = [
    'teacher', 'assignment', 'school enrolment', 'udise+', 'student enrollment',
    'protest', 'lathi-charge', 'lathi', 'protesters', 'assembly march', 'demonstration',
    'cricket', 'ipl', 'bollywood', 'movie', 'actor', 'actress', 'box office',
    'election', 'political party', 'speech', 'modi vs', 'rahul gandhi', 'bjp', 'congress',
    'hindutva', 'ideologue', 'mcbroom', 'spider-man', 'controversy', 'land dispute', 'firing along',
    'stock market', 'sensex', 'nifty', 'share price', 'crypto', 'iphone', 'gadget', 'smartphone',
    'gaza', 'israel', 'netanyahu', 'hamas', 'russia', 'ukraine', 'kharkiv', 'odesa',
    'moldova', 'florida', 'california', 'hawaii', 'naalehu', 'alaska', 'beijing', 'taiwan', 'trump', 'biden',
    'nws', 'flashfloodwarning', '#inwx', '#ffw', 'lake, in', 'porter, in', 'indiana',
    'denmark', 'skjern', 'hoboken', 'resiliencity', 'national coastline zone', 'central command zone'
  ];

  if (forbiddenTerms.some((term) => fullText.includes(term))) {
    return false;
  }

  // 2. Disaster Category Check
  const category = classifyCategory(fullText);
  if (!category) {
    return false;
  }

  // 3. Must match an explicit Indian location or mention India/NDRF/SDRF/Indian agencies
  const matchesIndianLocation = INDIAN_LOCATIONS.some((loc) => fullText.includes(loc.keyword));
  const hasExplicitIndiaAgency = fullText.includes('india') || fullText.includes('indian') || fullText.includes('ndrf') || fullText.includes('sdrf') || fullText.includes('ksdma') || fullText.includes('asdma') || fullText.includes('osdma') || fullText.includes('imd');

  if (!matchesIndianLocation && !hasExplicitIndiaAgency) {
    return false;
  }

  return true;
}

/**
 * Strict Geographical Relevance Check: Returns true ONLY if report pertains to India
 */
export function isIndiaRelated(text: string): boolean {
  return isStrictIndiaDisaster(text, '');
}

/**
 * Categorize headline + text into a Disaster Category
 */
export function classifyCategory(text: string): CategoryType | null {
  const lower = text.toLowerCase();

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return cat as CategoryType;
    }
  }

  return null;
}

/**
 * Infer severity based on urgency terms
 */
export function inferSeverity(text: string): SeverityLevel {
  const lower = text.toLowerCase();

  if (
    lower.includes('critical') ||
    lower.includes('fatal') ||
    lower.includes('trapped') ||
    lower.includes('evacuating') ||
    lower.includes('massive') ||
    lower.includes('emergency') ||
    lower.includes('dead') ||
    lower.includes('devastating')
  ) {
    return 'critical';
  }

  if (
    lower.includes('high') ||
    lower.includes('severe') ||
    lower.includes('warning') ||
    lower.includes('alert') ||
    lower.includes('disrupted') ||
    lower.includes('submerged')
  ) {
    return 'high';
  }

  if (lower.includes('moderate') || lower.includes('minor') || lower.includes('rising')) {
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
    if (lower.includes(loc.keyword)) {
      return {
        lat: loc.lat,
        lng: loc.lng,
        placeName: loc.keyword.charAt(0).toUpperCase() + loc.keyword.slice(1),
        state: loc.state,
      };
    }
  }

  // Smart regex extraction for "State" or "District" references in news text
  if (lower.includes('madhya pradesh') || lower.includes('m.p.')) return { lat: 22.9734, lng: 78.6569, placeName: 'Madhya Pradesh Sector', state: 'Madhya Pradesh' };
  if (lower.includes('uttar pradesh') || lower.includes('u.p.')) return { lat: 26.8467, lng: 80.9462, placeName: 'Uttar Pradesh Sector', state: 'Uttar Pradesh' };
  if (lower.includes('himachal pradesh') || lower.includes('h.p.')) return { lat: 31.1048, lng: 77.1734, placeName: 'Himachal Pradesh Sector', state: 'Himachal Pradesh' };
  if (lower.includes('arunachal pradesh')) return { lat: 28.2180, lng: 94.7278, placeName: 'Arunachal Sector', state: 'Arunachal Pradesh' };
  if (lower.includes('andhra pradesh')) return { lat: 15.9129, lng: 79.7400, placeName: 'Andhra Sector', state: 'Andhra Pradesh' };

  // Default Fallback
  return {
    lat: 20.5937,
    lng: 78.9629,
    placeName: 'Central Command Zone',
    state: 'Madhya Pradesh',
  };
}

/**
 * Calculate initial Credibility Score based on source reliability
 */
export function calculateCredibility(source: ReportSource): number {
  switch (source.type) {
    case 'official':
      return 95 + Math.floor(Math.random() * 5); // 95-100
    case 'news':
      return 80 + Math.floor(Math.random() * 12); // 80-92
    case 'sensor':
      return 90 + Math.floor(Math.random() * 8); // 90-98
    case 'social':
      return 55 + Math.floor(Math.random() * 20); // 55-75
    case 'citizen':
      return 60 + Math.floor(Math.random() * 20); // 60-80
    default:
      return 70;
  }
}
