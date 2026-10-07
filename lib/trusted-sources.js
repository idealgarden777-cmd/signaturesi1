/*
=========================================================
NEYO — TRUSTED SOURCES v2 (science, health, space, climate, law, history, tech, auto, entertainment)
Domains whose results are ranked higher in live search.
Tier 3 = official / primary, 2 = major trusted outlet,
1 = good specialist site. Pattern rules (gov.pk, edu.pk,
.gov, .edu, .ac.uk, .gov.uk, .int ...) cover thousands more
official sites automatically.
LOW_QUALITY = content farms / spam that get pushed down.
=========================================================
*/

const T3 = `
pbs.gov.pk sbp.org.pk secp.gov.pk pta.gov.pk fbr.gov.pk nadra.gov.pk ecp.gov.pk punjab.gov.pk sindh.gov.pk kp.gov.pk balochistan.gov.pk
pakistan.gov.pk finance.gov.pk mofa.gov.pk pmo.gov.pk na.gov.pk senate.gov.pk supremecourt.gov.pk lhc.gov.pk shc.gov.pk ihc.gov.pk
pmd.gov.pk ndma.gov.pk nepra.org.pk ogra.org.pk psx.com.pk hec.gov.pk fpsc.gov.pk ppsc.gop.pk pec.org.pk pmdc.pk drap.gov.pk
nih.org.pk pcb.com.pk psl-t20.com pia.com.pk pakrail.gov.pk wapda.gov.pk sngpl.com.pk ssgc.com.pk lesco.gov.pk kelectric.com
worldbank.org imf.org un.org who.int unicef.org wto.org oecd.org adb.org data.worldbank.org undp.org unesco.org unhcr.org wfp.org fao.org ilo.org
cdc.gov nih.gov fda.gov nasa.gov noaa.gov census.gov bls.gov sec.gov federalreserve.gov treasury.gov whitehouse.gov state.gov usgs.gov weather.gov
europa.eu ec.europa.eu ecb.europa.eu ema.europa.eu gov.uk ons.gov.uk nhs.uk bankofengland.co.uk parliament.uk
icc-cricket.com fifa.com olympics.com uefa.com nba.com nfl.com mlb.com formula1.com espncricinfo.com
openai.com anthropic.com deepmind.google blog.google ai.google.dev x.ai ai.meta.com mistral.ai huggingface.co
apple.com microsoft.com google.com support.google.com developer.apple.com learn.microsoft.com developer.mozilla.org github.com nvidia.com amd.com intel.com
samsung.com tesla.com spacex.com amazon.com aboutamazon.com meta.com about.fb.com
arxiv.org nature.com science.org thelancet.com nejm.org bmj.com jamanetwork.com pubmed.ncbi.nlm.nih.gov ncbi.nlm.nih.gov cochranelibrary.com
mayoclinic.org clevelandclinic.org hopkinsmedicine.org
wikipedia.org britannica.com
`;

const T2 = `
dawn.com geo.tv thenews.com.pk tribune.com.pk express.pk arynews.tv samaa.tv brecorder.com nation.com.pk dailytimes.com.pk app.com.pk
radio.gov.pk ptv.com.pk bolnews.com humnews.pk 92newshd.tv dunyanews.tv urdu.dunyanews.tv jang.com.pk urdupoint.com nawaiwaqt.com.pk
gnnhd.tv propakistani.pk profit.pakistantoday.com.pk pakistantoday.com.pk thefridaytimes.com mettisglobal.news businessrecorder.com
independenturdu.com bbc.com/urdu urdu.geo.tv urdu.arynews.tv aaj.tv aajenglish.tv minutemirror.com.pk tns.thenews.com.pk images.dawn.com
reuters.com apnews.com bbc.com bbc.co.uk aljazeera.com theguardian.com nytimes.com washingtonpost.com wsj.com ft.com economist.com bloomberg.com
cnn.com cnbc.com npr.org pbs.org abcnews.go.com cbsnews.com nbcnews.com usatoday.com latimes.com time.com newsweek.com theatlantic.com axios.com politico.com
thehill.com vox.com forbes.com fortune.com businessinsider.com marketwatch.com barrons.com investopedia.com morningstar.com finance.yahoo.com
afp.com france24.com dw.com euronews.com independent.co.uk telegraph.co.uk thetimes.co.uk sky.com news.sky.com
thehindu.com hindustantimes.com indianexpress.com timesofindia.indiatimes.com ndtv.com livemint.com economictimes.indiatimes.com
arabnews.com gulfnews.com khaleejtimes.com thenationalnews.com aa.com.tr trtworld.com scmp.com japantimes.co.jp straitstimes.com channelnewsasia.com
abc.net.au smh.com.au cbc.ca theglobeandmail.com
techcrunch.com theverge.com wired.com arstechnica.com engadget.com zdnet.com cnet.com tomshardware.com anandtech.com macrumors.com 9to5mac.com 9to5google.com
androidauthority.com gsmarena.com theinformation.com venturebeat.com technologyreview.com ieee.org spectrum.ieee.org semafor.com
espn.com skysports.com cricbuzz.com bbc.com/sport goal.com transfermarkt.com
healthline.com webmd.com medicalnewstoday.com
coindesk.com cointelegraph.com theblock.co coinmarketcap.com coingecko.com
statista.com ourworldindata.org pewresearch.org gallup.com
`;

const T1 = `
daraz.pk pakwheels.com zameen.com graana.com olx.com.pk priceoye.pk whatmobile.com.pk mobilemall.pk hamariweb.com rozee.pk mustakbil.com
foodpanda.pk careem.com bykea.com jazz.com.pk zong.com.pk telenor.com.pk ufone.com easypaisa.com.pk jazzcash.com.pk
hbl.com meezanbank.com ubldigital.com mcb.com.pk bankalfalah.com nbp.com.pk forex.pk
oladoc.com marham.pk sehat.com.pk
ilm.com.pk paperpk.com
stackoverflow.com stackexchange.com dev.to css-tricks.com smashingmagazine.com web.dev nodejs.org python.org docs.python.org react.dev vercel.com nextjs.org
supabase.com cloudflare.com aws.amazon.com cloud.google.com docs.github.com npmjs.com pypi.org
medium.com substack.com reddit.com news.ycombinator.com quora.com
imdb.com rottentomatoes.com metacritic.com letterboxd.com goodreads.com
rtings.com notebookcheck.net dxomark.com pcmag.com techradar.com digitaltrends.com trustedreviews.com
nerdwallet.com bankrate.com kiplinger.com
weather.com accuweather.com timeanddate.com
tripadvisor.com booking.com lonelyplanet.com
khanacademy.org coursera.org edx.org
merriam-webster.com dictionary.cambridge.org rekhta.org
`;

const T3_MORE = `
esa.int jaxa.jp isro.gov.in suparco.gov.pk cern.ch nist.gov energy.gov epa.gov nsf.gov noaa.gov climate.gov ipcc.ch wmo.int unep.org iea.org irena.org
nobelprize.org royalsociety.org nasonline.org aaas.org mit.edu stanford.edu harvard.edu ox.ac.uk cam.ac.uk caltech.edu berkeley.edu
plos.org cell.com sciencedirect.com springer.com link.springer.com wiley.com onlinelibrary.wiley.com acs.org pubs.acs.org aps.org journals.aps.org iop.org rsc.org pnas.org
frontiersin.org mdpi.com biorxiv.org medrxiv.org ssrn.com jstor.org scholar.google.com semanticscholar.org doi.org nobelprize.org
cancer.gov cancer.org heart.org diabetes.org alz.org niddk.nih.gov nimh.nih.gov medlineplus.gov clinicaltrials.gov uptodate.com msdmanuals.com merckmanuals.com
icrc.org amnesty.org hrw.org transparency.org sipri.org
loc.gov archives.gov si.edu smithsonianmag.com metmuseum.org britishmuseum.org
iso.org ietf.org w3.org unicode.org ecma-international.org kernel.org mozilla.org python.org rust-lang.org go.dev
iucn.org iucnredlist.org gbif.org worldwildlife.org nationalgeographic.com
`;

const T2_MORE = `
scientificamerican.com newscientist.com sciencenews.org sciencedaily.com phys.org livescience.com space.com quantamagazine.org nautil.us discovermagazine.com
popularmechanics.com popsci.com smithsonianmag.com sciencealert.com eurekalert.org theconversation.com bigthink.com aeon.co
universetoday.com skyandtelescope.org astronomy.com spacenews.com planetary.org nasaspaceflight.com spaceflightnow.com
carbonbrief.org insideclimatenews.org grist.org yaleclimateconnections.org climatecentral.org
statnews.com medscape.com fiercebiotech.com fiercepharma.com kff.org health.harvard.edu
history.com historyextra.com worldhistory.org ancient.eu
khanacademy.org mathworld.wolfram.com wolframalpha.com plato.stanford.edu iep.utm.edu
islamqa.info sunnah.com quran.com islamicfinder.org
lawfaremedia.org scotusblog.com justia.com law.cornell.edu
foreignaffairs.com foreignpolicy.com cfr.org brookings.edu rand.org chathamhouse.org carnegieendowment.org csis.org atlanticcouncil.org
nikkei.com asia.nikkei.com caixinglobal.com koreaherald.com koreatimes.co.kr bangkokpost.com dhakatribune.com thedailystar.net
irishtimes.com lemonde.fr spiegel.de elpais.com corriere.it
variety.com hollywoodreporter.com deadline.com billboard.com rollingstone.com pitchfork.com
motortrend.com caranddriver.com topgear.com autocar.co.uk edmunds.com kbb.com electrek.co insideevs.com
seriouseats.com bonappetit.com allrecipes.com
cricinfo.com wisden.com bleacherreport.com theathletic.com marca.com as.com
techmeme.com theregister.com bleepingcomputer.com krebsonsecurity.com thehackernews.com securityweek.com
infoq.com thenewstack.io lwn.net phoronix.com
tomsguide.com xda-developers.com howtogeek.com makeuseof.com
oilprice.com mining.com kitco.com investing.com tradingeconomics.com fxstreet.com
`;

const T1_MORE = `
sciencebuddies.org exploratorium.edu howstuffworks.com byjus.com toppr.com physicsclassroom.com chemguide.co.uk chem.libretexts.org bio.libretexts.org phys.libretexts.org openstax.org
w3schools.com geeksforgeeks.org freecodecamp.org realpython.com digitalocean.com docs.docker.com kubernetes.io tailwindcss.com getbootstrap.com vuejs.org angular.dev svelte.dev
docs.anthropic.com platform.openai.com paperswithcode.com kaggle.com
gsmarena.com notebookcheck.net
skyscanner.net kayak.com expedia.com airbnb.com
britishcouncil.org ielts.org ets.org collegeboard.org topuniversities.com timeshighereducation.com
pakistanmonumentmagazine.com youlinmagazine.com
ebay.com aliexpress.com walmart.com bestbuy.com
`;

const LOW_QUALITY = `
pinterest.com quora.com/profile answers.com ask.com ehow.com wikihow.com/category scribd.com slideshare.net coursehero.com
chegg.com brainly.com brainly.in studocu.com academia.edu/download
msn.com/en-us/news/other yahoo.com/news/other
`;

function parseList(text) {
    return text.split(/\s+/).map(item => item.trim().toLowerCase()).filter(Boolean);
}

const TIERS = new Map();
parseList(T1 + T1_MORE).forEach(domain => TIERS.set(domain, 1));
parseList(T2 + T2_MORE).forEach(domain => TIERS.set(domain, 2));
parseList(T3 + T3_MORE).forEach(domain => TIERS.set(domain, 3));
const LOW = parseList(LOW_QUALITY);

// Official / academic domains anywhere in the world.
const OFFICIAL_PATTERNS = [
    /\.gov\.pk$/, /\.gop\.pk$/, /\.edu\.pk$/, /\.org\.pk$/, /\.mil\.pk$/,
    /\.gov$/, /\.mil$/, /\.edu$/, /\.int$/,
    /\.gov\.[a-z]{2}$/, /\.go\.[a-z]{2}$/, /\.gob\.[a-z]{2}$/, /\.gouv\.[a-z]{2}$/,
    /\.ac\.[a-z]{2}$/, /\.edu\.[a-z]{2}$/, /\.gc\.ca$/, /\.europa\.eu$/
];

function parts(url) {
    try {
        const parsed = new URL(url);
        return {
            host: parsed.hostname.toLowerCase().replace(/^www\./, ""),
            path: parsed.pathname.toLowerCase()
        };
    } catch {
        return { host: "", path: "" };
    }
}

/**
 * Trust tier for a URL: 3 official, 2 major outlet, 1 good site,
 * 0 unknown, -1 low quality.
 */
export function trustTier(url) {
    const { host, path } = parts(url);
    if (!host) {
        return 0;
    }
    const full = host + path;
    if (LOW.some(entry => full.startsWith(entry) || host === entry)) {
        return -1;
    }
    // Exact host, then parent domains (news.bbc.co.uk -> bbc.co.uk), plus host/path entries.
    for (const [domain, tier] of TIERS) {
        if (domain.includes("/")) {
            if (full.startsWith(domain)) {
                return tier;
            }
        }
    }
    const labels = host.split(".");
    for (let i = 0; i < labels.length - 1; i += 1) {
        const candidate = labels.slice(i).join(".");
        if (TIERS.has(candidate)) {
            return TIERS.get(candidate);
        }
    }
    if (OFFICIAL_PATTERNS.some(pattern => pattern.test(host))) {
        return 3;
    }
    return 0;
}

/** Ranking bonus used by the search engine. */
export function trustBonus(url) {
    const tier = trustTier(url);
    return tier === -1 ? -0.8 : tier * 0.35;
}

export function trustLabel(url) {
    const tier = trustTier(url);
    return tier === 3 ? "official" : tier === 2 ? "trusted outlet" : tier === 1 ? "known site" : tier === -1 ? "low quality" : "unrated";
}

/* ---------------------------------------------------------
   PAKISTAN FOCUS
   --------------------------------------------------------- */

const PK_PATTERN = /\b(pakistan|pakistani|pak|lahore|karachi|islamabad|rawalpindi|peshawar|quetta|multan|faisalabad|sialkot|gujranwala|hyderabad sindh|punjab|sindh|kpk|khyber|balochistan|gilgit|azad kashmir|ajk|pkr|rupee|rupay|rs\.?|psl|pcb|babar|rizwan|shaheen|imran khan|nawaz|shehbaz|maryam|bilawal|zardari|pti|pmln|ppp|nadra|fbr|wapda|lesco|k-electric|sngpl|petrol|dollar rate|gold rate|sona|bijli|load ?shedding|matric|inter result|board result|daraz|pakwheels|zameen|olx|jazz|zong|telenor|ufone|easypaisa|jazzcash)\b/i;

export function isPakistanQuery(text = "") {
    return PK_PATTERN.test(String(text || ""));
}

// Groups used to build site-targeted queries for Pakistani questions.
const PK_SITE_GROUPS = {
    news: ["dawn.com", "geo.tv", "tribune.com.pk", "thenews.com.pk", "arynews.tv", "brecorder.com"],
    money: ["brecorder.com", "sbp.org.pk", "psx.com.pk", "propakistani.pk", "profit.pakistantoday.com.pk", "forex.pk"],
    tech: ["propakistani.pk", "whatmobile.com.pk", "priceoye.pk", "daraz.pk", "pta.gov.pk"],
    cars: ["pakwheels.com", "propakistani.pk", "dawn.com"],
    property: ["zameen.com", "graana.com", "dawn.com"],
    sports: ["espncricinfo.com", "cricbuzz.com", "pcb.com.pk", "geo.tv"],
    jobs: ["rozee.pk", "fpsc.gov.pk", "ppsc.gop.pk", "mustakbil.com"],
    education: ["hec.gov.pk", "ilm.com.pk", "dawn.com"]
};

function pkGroup(text) {
    const value = String(text || "").toLowerCase();
    if (/\b(car|gari|gaari|bike|honda|toyota|suzuki|kia|hyundai|mg|changan|pakwheels)\b/.test(value)) return "cars";
    if (/\b(plot|house|ghar|makan|property|zameen|dha|bahria|rent|kiraya)\b/.test(value)) return "property";
    if (/\b(mobile|phone|iphone|samsung|infinix|tecno|vivo|oppo|xiaomi|laptop|pta|tax on mobile)\b/.test(value)) return "tech";
    if (/\b(psl|cricket|match|score|babar|rizwan|shaheen|pcb|hockey|football)\b/.test(value)) return "sports";
    if (/\b(dollar|rate|gold|sona|psx|stock|share|interest|sbp|inflation|mehngai|budget|tax|fbr)\b/.test(value)) return "money";
    if (/\b(job|naukri|vacancy|fpsc|ppsc|nts|bharti)\b/.test(value)) return "jobs";
    if (/\b(result|matric|inter|admission|university|hec|board|exam|paper)\b/.test(value)) return "education";
    return "news";
}

/**
 * Extra site-targeted query for Pakistani questions, e.g.
 * "petrol price (site:dawn.com OR site:brecorder.com OR ...)".
 */
export function pakistanSiteQuery(query = "") {
    const sites = PK_SITE_GROUPS[pkGroup(query)] || PK_SITE_GROUPS.news;
    return `${query} (${sites.slice(0, 5).map(site => `site:${site}`).join(" OR ")})`;
}

export function trustedDomainCount() {
    return TIERS.size;
}

/* ---------------------------------------------------------
   TOPIC FOCUS (science, space, health, climate)
   --------------------------------------------------------- */

const TOPIC_GROUPS = [
    {
        pattern: /\b(space|nasa|planet|mars|moon|chand|star|sitara|galaxy|black hole|universe|kainat|rocket|satellite|asteroid|comet|telescope|spacex|isro|suparco)\b/i,
        sites: ["nasa.gov", "esa.int", "space.com", "spacenews.com", "scientificamerican.com"]
    },
    {
        pattern: /\b(health|disease|bimari|medicine|dawai|doctor|symptom|alamat|cancer|diabetes|sugar|heart|dil|blood pressure|bp|vaccine|virus|dengue|covid|vitamin|diet|pregnan|hamal)\b/i,
        sites: ["who.int", "mayoclinic.org", "nih.gov", "cdc.gov", "clevelandclinic.org"]
    },
    {
        pattern: /\b(climate|global warming|mausam|weather|flood|selab|heatwave|garmi|pollution|smog|aqi|earthquake|zalzala|glacier)\b/i,
        sites: ["ipcc.ch", "noaa.gov", "carbonbrief.org", "wmo.int", "nasa.gov"]
    },
    {
        pattern: /\b(science|scientist|research|study|physics|chemistry|biology|dna|gene|cell|atom|quantum|evolution|fossil|dinosaur|brain|dimagh|experiment|discovery)\b/i,
        sites: ["nature.com", "science.org", "sciencedaily.com", "newscientist.com", "quantamagazine.org"]
    }
];

/** Extra site-limited query for science/space/health/climate questions, or "". */
export function topicSiteQuery(text = "", query = "") {
    const group = TOPIC_GROUPS.find(item => item.pattern.test(String(text || "")));
    if (!group) {
        return "";
    }
    return `${query || text} (${group.sites.map(site => `site:${site}`).join(" OR ")})`;
}
