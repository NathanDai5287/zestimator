import json
import random
from playwright.sync_api import sync_playwright

# Stealth patches: hide Playwright's automation fingerprints from PerimeterX
_STEALTH_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.chrome = {runtime: {}};
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
const _origQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (p) =>
    p.name === 'notifications'
        ? Promise.resolve({state: Notification.permission})
        : _origQuery(p);
"""

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

# Search URLs to pick from randomly so results vary
_SEARCH_URLS = [
    "https://www.zillow.com/denver-co/",
    "https://www.zillow.com/austin-tx/",
    "https://www.zillow.com/nashville-tn/",
    "https://www.zillow.com/portland-or/",
    "https://www.zillow.com/charlotte-nc/",
    "https://www.zillow.com/atlanta-ga/",
    "https://www.zillow.com/phoenix-az/",
    "https://www.zillow.com/las-vegas-nv/",
    "https://www.zillow.com/miami-fl/",
    "https://www.zillow.com/seattle-wa/",
    "https://www.zillow.com/chicago-il/",
    "https://www.zillow.com/dallas-tx/",
    "https://www.zillow.com/houston-tx/",
    "https://www.zillow.com/san-antonio-tx/",
    "https://www.zillow.com/philadelphia-pa/",
]


def get_random_house():
    """
    Returns a dict of property data for a randomly selected Zillow listing.
    Raises RuntimeError if scraping fails.
    """
    with sync_playwright() as p:
        # channel='chrome' uses the real installed Chrome binary,
        # which has a much lower bot-detection hit rate than bundled Chromium.
        browser = p.chromium.launch(
            headless=True,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent=_USER_AGENT,
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "sec-ch-ua": '"Google Chrome";v="122", "Not(A:Brand";v="24"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"macOS"',
            },
        )
        context.add_init_script(_STEALTH_SCRIPT)
        page = context.new_page()

        try:
            search_url = random.choice(_SEARCH_URLS)
            page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
            # Give JS time to hydrate the page state
            page.wait_for_timeout(random.randint(3000, 5000))

            title = page.title()
            if "Access" in title or "denied" in title.lower():
                raise RuntimeError("Bot detection triggered on search page")

            # The page embeds a large JSON blob in an inline <script> tag.
            # Path: props.pageProps.searchPageState.cat1.searchResults.listResults
            script_json = page.evaluate("""() => {
                for (const s of document.querySelectorAll('script:not([src])')) {
                    if (s.textContent.includes('listResults')) {
                        return s.textContent;
                    }
                }
                return null;
            }""")

            if not script_json:
                raise RuntimeError("Could not find inline script with listing data")

            data = json.loads(script_json)
            listings = (
                data["props"]["pageProps"]["searchPageState"]
                ["cat1"]["searchResults"]["listResults"]
            )

            if not listings:
                raise RuntimeError("listResults was empty")

            listing = random.choice(listings)
            return _format(listing)

        finally:
            browser.close()


def _format(listing: dict) -> dict:
    info = listing.get("hdpData", {}).get("homeInfo", {})

    lat = info.get("latitude") or (listing.get("latLong") or {}).get("latitude")
    lng = info.get("longitude") or (listing.get("latLong") or {}).get("longitude")

    # Build photo URLs: baseUrl uses a {photoKey} template
    photos = []
    carousel = listing.get("carouselPhotosComposable") or {}
    base_url = carousel.get("baseUrl", "")
    for photo in carousel.get("photoData") or []:
        key = photo.get("photoKey")
        if key and base_url:
            photos.append(base_url.replace("{photoKey}", key))

    return {
        "zpid": listing.get("zpid"),
        "url": listing.get("detailUrl"),
        "address": listing.get("address"),
        "addressStreet": listing.get("addressStreet"),
        "city": listing.get("addressCity"),
        "state": listing.get("addressState"),
        "zipCode": listing.get("addressZipcode"),
        "coordinates": {"latitude": lat, "longitude": lng},
        # Deep-links directly into Google Maps Street View — no API key needed
        "streetViewUrl": (
            f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lng}"
            if lat and lng
            else None
        ),
        "price": info.get("price") or listing.get("unformattedPrice"),
        "taxAssessedValue": info.get("taxAssessedValue"),
        "propertyType": info.get("homeType"),
        "status": listing.get("statusType"),
        "statusText": listing.get("statusText"),
        "bedrooms": info.get("bedrooms") or listing.get("beds"),
        "bathrooms": info.get("bathrooms") or listing.get("baths"),
        "squareFootage": info.get("livingArea") or listing.get("area"),
        "lotSize": info.get("lotAreaValue"),
        "lotSizeUnit": info.get("lotAreaUnit"),
        "yearBuilt": info.get("yearBuilt"),
        "daysOnZillow": info.get("daysOnZillow"),
        "photos": photos,
    }
