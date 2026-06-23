from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
import os
import re

app = FastAPI(title="Art Auction Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FUSEKI_URL = os.environ.get("FUSEKI_URL", "http://localhost:3030")
DATASET = "art-auction"
SPARQL_ENDPOINT = f"{FUSEKI_URL}/{DATASET}/sparql"
FUSEKI_AUTH = ("admin", "art-auction-2024")
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", "/app/frontend")

# In-memory bid store: {lot_id: {"bidder": str, "amount": int, "history": [...]}}
bid_store: dict = {}

PREFIXES = """
PREFIX artwork:    <http://art-auction.io/ontology/artwork#>
PREFIX auction:    <http://art-auction.io/ontology/auction#>
PREFIX provenance: <http://art-auction.io/ontology/provenance#>
PREFIX rdf:        <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:       <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd:        <http://www.w3.org/2001/XMLSchema#>
PREFIX aw:         <http://art-auction.io/data/artwork/>
PREFIX ar:         <http://art-auction.io/data/artist/>
PREFIX lot:        <http://art-auction.io/data/lot/>
PREFIX mv:         <http://art-auction.io/data/movement/>
PREFIX pr:         <http://art-auction.io/data/period/>
PREFIX cp:         <http://art-auction.io/data/palette/>
PREFIX prov:       <http://art-auction.io/data/provenance/>
"""


async def sparql_query(query: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            SPARQL_ENDPOINT,
            data={"query": PREFIXES + "\n" + query},
            headers={"Accept": "application/sparql-results+json"},
            auth=FUSEKI_AUTH,
            timeout=30,
        )
        r.raise_for_status()
        return r.json()


def val(binding: dict, key: str, default=None):
    return binding.get(key, {}).get("value", default)


def uri_id(uri: str) -> str:
    if not uri:
        return ""
    return uri.rstrip("/").split("/")[-1]


# ─── Artworks ────────────────────────────────────────────────────────────────

@app.get("/api/artworks")
async def list_artworks(
    movement: str | None = None,
    temperature: str | None = None,
    decade: str | None = None,
    artist_id: str | None = None,
):
    clauses = []
    if movement:
        clauses.append(f'  ?aw artwork:belongsToMovement ?fmv . ?fmv artwork:name "{movement}" .')
    if temperature:
        clauses.append(f'  ?aw artwork:hasColorPalette ?fcp . ?fcp artwork:temperature "{temperature}" .')
    if decade:
        clauses.append(f'  ?aw artwork:createdIn ?fp . ?fp artwork:decade "{decade}" .')
    if artist_id:
        clauses.append(f'  ?aw artwork:createdBy ar:{artist_id} .')

    extra = "\n".join(clauses)

    result = await sparql_query(f"""
SELECT DISTINCT ?aw ?title ?year ?medium ?arLabel ?mvName ?decade ?temp ?hammerPrice
WHERE {{
  ?aw a artwork:Artwork ;
      rdfs:label ?title ;
      artwork:yearCreated ?year ;
      artwork:createdBy ?ar .
  ?ar rdfs:label ?arLabel .
  FILTER(LANG(?title) = "ko")
  FILTER(LANG(?arLabel) = "ko")
{extra}
  OPTIONAL {{
    ?aw artwork:belongsToMovement ?mv .
    ?mv artwork:name ?mvName .
  }}
  OPTIONAL {{ ?aw artwork:medium ?medium }}
  OPTIONAL {{
    ?aw artwork:createdIn ?period .
    ?period artwork:decade ?decade .
  }}
  OPTIONAL {{
    ?aw artwork:hasColorPalette ?cp .
    ?cp artwork:temperature ?temp .
  }}
  OPTIONAL {{
    ?lot auction:forArtwork ?aw ;
         auction:hammerPrice ?hammerPrice ;
         auction:status "SETTLED" .
  }}
}}
ORDER BY DESC(?year)
""")

    seen = set()
    artworks = []
    for b in result["results"]["bindings"]:
        aw_id = uri_id(val(b, "aw"))
        if aw_id in seen:
            continue
        seen.add(aw_id)
        artworks.append({
            "id":         aw_id,
            "title":      val(b, "title"),
            "year":       val(b, "year"),
            "medium":     val(b, "medium"),
            "artist":     val(b, "arLabel"),
            "movement":   val(b, "mvName"),
            "decade":     val(b, "decade"),
            "colorTemp":  val(b, "temp"),
            "hammerPrice":val(b, "hammerPrice"),
        })
    return artworks


@app.get("/api/artworks/{artwork_id}")
async def get_artwork(artwork_id: str):
    result = await sparql_query(f"""
SELECT ?title ?titleEn ?year ?medium ?width ?height
       ?arLabel ?arLabelEn ?birthYear ?deathYear ?nationality
       ?mvName ?decade ?era ?temp ?saturation ?brightness ?dominantColor
WHERE {{
  aw:{artwork_id} a artwork:Artwork ;
      rdfs:label ?title ;
      artwork:yearCreated ?year ;
      artwork:createdBy ?ar .
  ?ar rdfs:label ?arLabel .
  FILTER(LANG(?title) = "ko")
  FILTER(LANG(?arLabel) = "ko")
  OPTIONAL {{ aw:{artwork_id} rdfs:label ?titleEn . FILTER(LANG(?titleEn) = "en") }}
  OPTIONAL {{ ?ar rdfs:label ?arLabelEn . FILTER(LANG(?arLabelEn) = "en") }}
  OPTIONAL {{ aw:{artwork_id} artwork:medium ?medium }}
  OPTIONAL {{ aw:{artwork_id} artwork:width  ?width }}
  OPTIONAL {{ aw:{artwork_id} artwork:height ?height }}
  OPTIONAL {{ ?ar artwork:birthYear  ?birthYear }}
  OPTIONAL {{ ?ar artwork:deathYear  ?deathYear }}
  OPTIONAL {{ ?ar artwork:nationality ?nationality }}
  OPTIONAL {{
    aw:{artwork_id} artwork:belongsToMovement ?mv .
    ?mv artwork:name ?mvName .
  }}
  OPTIONAL {{
    aw:{artwork_id} artwork:createdIn ?period .
    ?period artwork:decade ?decade .
    OPTIONAL {{ ?period artwork:era ?era }}
  }}
  OPTIONAL {{
    aw:{artwork_id} artwork:hasColorPalette ?cp .
    ?cp artwork:temperature   ?temp .
    OPTIONAL {{ ?cp artwork:saturation    ?saturation }}
    OPTIONAL {{ ?cp artwork:brightness    ?brightness }}
    OPTIONAL {{ ?cp artwork:dominantColor ?dominantColor }}
  }}
}}
LIMIT 1
""")

    if not result["results"]["bindings"]:
        raise HTTPException(404, "Artwork not found")
    b = result["results"]["bindings"][0]
    return {
        "id":           artwork_id,
        "title":        val(b, "title"),
        "titleEn":      val(b, "titleEn"),
        "year":         val(b, "year"),
        "medium":       val(b, "medium"),
        "width":        val(b, "width"),
        "height":       val(b, "height"),
        "artist":       val(b, "arLabel"),
        "artistEn":     val(b, "arLabelEn"),
        "birthYear":    val(b, "birthYear"),
        "deathYear":    val(b, "deathYear"),
        "nationality":  val(b, "nationality"),
        "movement":     val(b, "mvName"),
        "decade":       val(b, "decade"),
        "era":          val(b, "era"),
        "colorTemp":    val(b, "temp"),
        "colorSat":     val(b, "saturation"),
        "colorBright":  val(b, "brightness"),
        "dominantColor":val(b, "dominantColor"),
    }


@app.get("/api/artworks/{artwork_id}/lots")
async def get_artwork_lots(artwork_id: str):
    result = await sparql_query(f"""
SELECT ?lot ?lotNumber ?status ?auctionDate ?auctionHouse
       ?estimateMin ?estimateMax ?hammerPrice ?currency
WHERE {{
  ?lot a auction:Lot ;
       auction:forArtwork aw:{artwork_id} ;
       auction:lotNumber   ?lotNumber ;
       auction:status      ?status ;
       auction:auctionDate ?auctionDate ;
       auction:auctionHouse ?auctionHouse .
  OPTIONAL {{ ?lot auction:estimatedPriceMin ?estimateMin }}
  OPTIONAL {{ ?lot auction:estimatedPriceMax ?estimateMax }}
  OPTIONAL {{ ?lot auction:hammerPrice ?hammerPrice }}
  OPTIONAL {{ ?lot auction:currency ?currency }}
}}
ORDER BY ?auctionDate
""")
    return [{
        "id":          uri_id(val(b, "lot")),
        "lotNumber":   val(b, "lotNumber"),
        "status":      val(b, "status"),
        "auctionDate": val(b, "auctionDate"),
        "auctionHouse":val(b, "auctionHouse"),
        "estimateMin": val(b, "estimateMin"),
        "estimateMax": val(b, "estimateMax"),
        "hammerPrice": val(b, "hammerPrice"),
        "currency":    val(b, "currency", "KRW"),
    } for b in result["results"]["bindings"]]


# ─── Artists ──────────────────────────────────────────────────────────────────

@app.get("/api/artists")
async def list_artists():
    result = await sparql_query("""
SELECT ?ar ?label ?labelEn ?birthYear ?deathYear ?nationality ?mvName
       (COUNT(?aw) AS ?artworkCount)
WHERE {
  ?ar a artwork:Artist ;
      rdfs:label ?label .
  FILTER(LANG(?label) = "ko")
  OPTIONAL { ?ar rdfs:label ?labelEn . FILTER(LANG(?labelEn) = "en") }
  OPTIONAL { ?ar artwork:birthYear  ?birthYear }
  OPTIONAL { ?ar artwork:deathYear  ?deathYear }
  OPTIONAL { ?ar artwork:nationality ?nationality }
  OPTIONAL {
    ?ar artwork:memberOf ?mv .
    ?mv artwork:name ?mvName .
  }
  OPTIONAL { ?aw artwork:createdBy ?ar }
}
GROUP BY ?ar ?label ?labelEn ?birthYear ?deathYear ?nationality ?mvName
ORDER BY ?birthYear
""")
    return [{
        "id":          uri_id(val(b, "ar")),
        "name":        val(b, "label"),
        "nameEn":      val(b, "labelEn"),
        "birthYear":   val(b, "birthYear"),
        "deathYear":   val(b, "deathYear"),
        "nationality": val(b, "nationality"),
        "movement":    val(b, "mvName"),
        "artworkCount":val(b, "artworkCount", "0"),
    } for b in result["results"]["bindings"]]


# ─── Lots ─────────────────────────────────────────────────────────────────────

@app.get("/api/lots")
async def list_lots(status: str | None = None):
    status_filter = f'  FILTER(?status = "{status}")' if status else ""

    result = await sparql_query(f"""
SELECT ?lot ?lotNumber ?status ?auctionDate ?auctionHouse ?currency
       ?awTitle ?arLabel
       ?estimateMin ?estimateMax ?hammerPrice
WHERE {{
  ?lot a auction:Lot ;
       auction:lotNumber   ?lotNumber ;
       auction:status      ?status ;
       auction:auctionDate ?auctionDate ;
       auction:auctionHouse ?auctionHouse ;
       auction:forArtwork  ?aw .
  ?aw rdfs:label ?awTitle ;
      artwork:createdBy ?ar .
  ?ar rdfs:label ?arLabel .
  FILTER(LANG(?awTitle) = "ko")
  FILTER(LANG(?arLabel) = "ko")
  OPTIONAL {{ ?lot auction:currency ?currency }}
  OPTIONAL {{ ?lot auction:estimatedPriceMin ?estimateMin }}
  OPTIONAL {{ ?lot auction:estimatedPriceMax ?estimateMax }}
  OPTIONAL {{ ?lot auction:hammerPrice ?hammerPrice }}
{status_filter}
}}
ORDER BY DESC(?auctionDate)
""")

    return [{
        "id":          uri_id(val(b, "lot")),
        "lotNumber":   val(b, "lotNumber"),
        "status":      val(b, "status"),
        "auctionDate": val(b, "auctionDate"),
        "auctionHouse":val(b, "auctionHouse"),
        "artworkTitle":val(b, "awTitle"),
        "artist":      val(b, "arLabel"),
        "currency":    val(b, "currency", "KRW"),
        "estimateMin": val(b, "estimateMin"),
        "estimateMax": val(b, "estimateMax"),
        "hammerPrice": val(b, "hammerPrice"),
    } for b in result["results"]["bindings"]]


@app.get("/api/lots/{lot_id}")
async def get_lot(lot_id: str):
    result = await sparql_query(f"""
SELECT ?lotNumber ?status ?auctionDate ?auctionHouse ?currency
       ?awId ?awTitle ?awTitleEn ?year ?medium ?width ?height
       ?arLabel ?birthYear ?deathYear ?nationality
       ?mvName ?decade ?temp
       ?estimateMin ?estimateMax ?hammerPrice
WHERE {{
  lot:{lot_id} a auction:Lot ;
       auction:lotNumber   ?lotNumber ;
       auction:status      ?status ;
       auction:auctionDate ?auctionDate ;
       auction:auctionHouse ?auctionHouse ;
       auction:forArtwork  ?aw .
  ?aw rdfs:label ?awTitle ;
      artwork:yearCreated  ?year ;
      artwork:createdBy    ?ar .
  ?ar rdfs:label ?arLabel .
  FILTER(LANG(?awTitle) = "ko")
  FILTER(LANG(?arLabel) = "ko")
  OPTIONAL {{ ?aw rdfs:label ?awTitleEn . FILTER(LANG(?awTitleEn) = "en") }}
  OPTIONAL {{ ?aw artwork:medium ?medium }}
  OPTIONAL {{ ?aw artwork:width  ?width }}
  OPTIONAL {{ ?aw artwork:height ?height }}
  OPTIONAL {{ ?ar artwork:birthYear  ?birthYear }}
  OPTIONAL {{ ?ar artwork:deathYear  ?deathYear }}
  OPTIONAL {{ ?ar artwork:nationality ?nationality }}
  OPTIONAL {{ lot:{lot_id} auction:currency ?currency }}
  OPTIONAL {{ lot:{lot_id} auction:estimatedPriceMin ?estimateMin }}
  OPTIONAL {{ lot:{lot_id} auction:estimatedPriceMax ?estimateMax }}
  OPTIONAL {{ lot:{lot_id} auction:hammerPrice ?hammerPrice }}
  OPTIONAL {{
    ?aw artwork:belongsToMovement ?mv .
    ?mv artwork:name ?mvName .
  }}
  OPTIONAL {{
    ?aw artwork:createdIn ?period .
    ?period artwork:decade ?decade .
  }}
  OPTIONAL {{
    ?aw artwork:hasColorPalette ?cp .
    ?cp artwork:temperature ?temp .
  }}
  BIND(STR(?aw) AS ?awId)
}}
LIMIT 1
""")

    if not result["results"]["bindings"]:
        raise HTTPException(404, "Lot not found")

    b = result["results"]["bindings"][0]
    return {
        "id":           lot_id,
        "lotNumber":    val(b, "lotNumber"),
        "status":       val(b, "status"),
        "auctionDate":  val(b, "auctionDate"),
        "auctionHouse": val(b, "auctionHouse"),
        "artworkId":    uri_id(val(b, "awId")),
        "artworkTitle": val(b, "awTitle"),
        "artworkTitleEn": val(b, "awTitleEn"),
        "year":         val(b, "year"),
        "medium":       val(b, "medium"),
        "width":        val(b, "width"),
        "height":       val(b, "height"),
        "artist":       val(b, "arLabel"),
        "birthYear":    val(b, "birthYear"),
        "deathYear":    val(b, "deathYear"),
        "nationality":  val(b, "nationality"),
        "movement":     val(b, "mvName"),
        "decade":       val(b, "decade"),
        "colorTemp":    val(b, "temp"),
        "currency":     val(b, "currency", "KRW"),
        "estimateMin":  val(b, "estimateMin"),
        "estimateMax":  val(b, "estimateMax"),
        "hammerPrice":  val(b, "hammerPrice"),
        "currentBid":   bid_store.get(lot_id),
    }


# ─── Bids ─────────────────────────────────────────────────────────────────────

class BidRequest(BaseModel):
    bidder: str
    amount: int


@app.get("/api/lots/{lot_id}/bid")
async def get_bid(lot_id: str):
    return {"lotId": lot_id, "bid": bid_store.get(lot_id)}


@app.post("/api/lots/{lot_id}/bid")
async def place_bid(lot_id: str, req: BidRequest):
    if not req.bidder.strip():
        raise HTTPException(400, "입찰자 이름을 입력해주세요")
    if req.amount <= 0:
        raise HTTPException(400, "유효한 입찰가를 입력해주세요")

    lot = await get_lot(lot_id)
    if lot["status"] != "SCHEDULED":
        raise HTTPException(400, f"입찰 불가: 로트 상태가 {lot['status']}입니다")

    min_bid = int(lot.get("estimateMin") or 0)
    if req.amount < min_bid:
        raise HTTPException(
            400,
            f"입찰가({req.amount:,}원)가 최소 추정가({min_bid:,}원)보다 낮습니다",
        )

    current = bid_store.get(lot_id)
    if current and req.amount <= current["amount"]:
        raise HTTPException(
            400,
            f"입찰가({req.amount:,}원)가 현재 최고가({current['amount']:,}원)보다 높아야 합니다",
        )

    history = (current.get("history", []) if current else []) + [
        {"bidder": req.bidder, "amount": req.amount}
    ]
    bid_store[lot_id] = {"bidder": req.bidder, "amount": req.amount, "history": history}

    return {
        "success": True,
        "lotId":   lot_id,
        "bidder":  req.bidder,
        "amount":  req.amount,
        "message": f"{req.bidder}님의 입찰가 {req.amount:,}원이 등록되었습니다",
    }


# ─── Provenance ───────────────────────────────────────────────────────────────

@app.get("/api/provenance/{artwork_id}")
async def get_provenance(artwork_id: str):
    result = await sparql_query(f"""
SELECT ?owner ?acquisitionDate ?transferDate ?institution ?method ?label
WHERE {{
  aw:{artwork_id} artwork:hasProvenance ?first .
  ?first (provenance:nextRecord)* ?record .
  ?record provenance:owner         ?owner ;
          provenance:acquisitionDate ?acquisitionDate .
  OPTIONAL {{ ?record rdfs:label              ?label . FILTER(LANG(?label) = "ko") }}
  OPTIONAL {{ ?record provenance:transferDate  ?transferDate }}
  OPTIONAL {{ ?record provenance:institution   ?institution }}
  OPTIONAL {{ ?record provenance:acquisitionMethod ?method }}
}}
ORDER BY ?acquisitionDate
""")
    return [{
        "owner":           val(b, "owner"),
        "acquisitionDate": val(b, "acquisitionDate"),
        "transferDate":    val(b, "transferDate"),
        "institution":     val(b, "institution"),
        "method":          val(b, "method"),
        "label":           val(b, "label"),
    } for b in result["results"]["bindings"]]


# ─── Stats ────────────────────────────────────────────────────────────────────

@app.get("/api/stats")
async def get_stats():
    result = await sparql_query("""
SELECT
  (COUNT(DISTINCT ?aw) AS ?artworks)
  (COUNT(DISTINCT ?ar) AS ?artists)
  (COUNT(DISTINCT ?lot) AS ?lots)
  (SUM(?hp) AS ?totalVolume)
  (MAX(?hp) AS ?maxHammer)
WHERE {
  ?aw a artwork:Artwork .
  ?ar a artwork:Artist .
  ?lot a auction:Lot ;
       auction:status "SETTLED" ;
       auction:hammerPrice ?hp .
}
""")
    if not result["results"]["bindings"]:
        return {"artworks": 0, "artists": 0, "lots": 0, "totalVolume": 0, "maxHammer": 0}
    b = result["results"]["bindings"][0]
    return {
        "artworks":    int(val(b, "artworks", 0)),
        "artists":     int(val(b, "artists", 0)),
        "lots":        int(val(b, "lots", 0)),
        "totalVolume": int(float(val(b, "totalVolume", 0))),
        "maxHammer":   int(float(val(b, "maxHammer", 0))),
    }


# ─── Search ───────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str


@app.post("/api/search")
async def semantic_search(req: SearchRequest):
    q = req.query.lower()
    q_safe = q.replace('"', '\\"').replace("\\", "\\\\")
    clauses = []
    price_filter = ""

    # Decade
    for prefix in ["1880","1890","1900","1910","1920","1930","1940","1950","1960","1970","1980"]:
        if prefix in q or f"{prefix[2:]}년대" in q:
            clauses.append(f'  ?aw artwork:createdIn ?fp . ?fp artwork:decade "{prefix}s" .')
            break

    # Color temperature
    if any(w in q for w in ["따뜻", "warm", "붉", "노란", "황금", "주황"]):
        clauses.append('  ?aw artwork:hasColorPalette ?fcp . ?fcp artwork:temperature "warm" .')
    elif any(w in q for w in ["차가운", "차갑", "cool", "파란", "푸른", "청색"]):
        clauses.append('  ?aw artwork:hasColorPalette ?fcp . ?fcp artwork:temperature "cool" .')

    # Art movement
    if any(w in q for w in ["인상주의", "인상파", "impressionism"]):
        clauses.append('  ?aw artwork:belongsToMovement ?fmv . ?fmv artwork:name "인상주의" .')
    elif any(w in q for w in ["추상표현주의", "추상 표현", "abstract expressionism", "환기"]):
        clauses.append('  ?aw artwork:belongsToMovement ?fmv . ?fmv artwork:name "한국 추상표현주의" .')
    elif any(w in q for w in ["리얼리즘", "realism", "사실주의", "민족", "박수근", "이중섭"]):
        clauses.append('  ?aw artwork:belongsToMovement ?fmv . ?fmv artwork:name "한국 민족 리얼리즘" .')
    elif any(w in q for w in ["구상", "서정", "lyrical", "천경자"]):
        clauses.append('  ?aw artwork:belongsToMovement ?fmv . ?fmv artwork:name "한국 서정적 구상" .')

    # Artist
    artist_map = {
        "김환기": "kim-whanki",
        "박수근": "park-sookeun",
        "이중섭": "lee-jungseob",
        "천경자": "chun-kyungja",
        "모네": "monet-claude",
    }
    for name, aid in artist_map.items():
        if name in q:
            clauses.append(f'  ?aw artwork:createdBy ar:{aid} .')
            break

    # Price filter (억 단위)
    price_match = re.search(r'(\d+)억', q)
    if price_match:
        min_price = int(price_match.group(1)) * 100_000_000
        price_filter = f"FILTER(?hp >= {min_price})"

    if clauses or price_filter:
        sparql_body = f"""
SELECT DISTINCT ?aw ?title ?year ?arLabel ?mvName ?hp ?auctionHouse ?auctionDate
WHERE {{
  ?aw a artwork:Artwork ;
      rdfs:label ?title ;
      artwork:yearCreated ?year ;
      artwork:createdBy ?ar .
  ?ar rdfs:label ?arLabel .
  FILTER(LANG(?title) = "ko")
  FILTER(LANG(?arLabel) = "ko")
{"".join(clauses)}
  OPTIONAL {{
    ?aw artwork:belongsToMovement ?mv .
    ?mv artwork:name ?mvName .
  }}
  OPTIONAL {{
    ?lot auction:forArtwork ?aw ;
         auction:status "SETTLED" ;
         auction:hammerPrice ?hp ;
         auction:auctionHouse ?auctionHouse ;
         auction:auctionDate ?auctionDate .
    {price_filter}
  }}
}}
ORDER BY DESC(?hp)
LIMIT 20"""
    else:
        sparql_body = f"""
SELECT DISTINCT ?aw ?title ?year ?arLabel ?mvName ?hp ?auctionHouse
WHERE {{
  ?aw a artwork:Artwork ;
      rdfs:label ?title ;
      artwork:yearCreated ?year ;
      artwork:createdBy ?ar .
  ?ar rdfs:label ?arLabel .
  FILTER(LANG(?title) = "ko")
  FILTER(LANG(?arLabel) = "ko")
  FILTER(
    CONTAINS(LCASE(STR(?title)), "{q_safe}") ||
    CONTAINS(LCASE(STR(?arLabel)), "{q_safe}")
  )
  OPTIONAL {{
    ?aw artwork:belongsToMovement ?mv .
    ?mv artwork:name ?mvName .
  }}
  OPTIONAL {{
    ?lot auction:forArtwork ?aw ;
         auction:status "SETTLED" ;
         auction:hammerPrice ?hp ;
         auction:auctionHouse ?auctionHouse .
  }}
}}
ORDER BY DESC(?hp)
LIMIT 20"""

    result = await sparql_query(sparql_body)

    seen = set()
    artworks = []
    for b in result["results"]["bindings"]:
        aw_id = uri_id(val(b, "aw"))
        if aw_id in seen:
            continue
        seen.add(aw_id)
        artworks.append({
            "id":          aw_id,
            "title":       val(b, "title"),
            "year":        val(b, "year"),
            "artist":      val(b, "arLabel"),
            "movement":    val(b, "mvName"),
            "hammerPrice": val(b, "hp"),
            "auctionHouse":val(b, "auctionHouse"),
        })

    return {
        "query":   req.query,
        "sparql":  PREFIXES.strip() + "\n" + sparql_body.strip(),
        "results": artworks,
        "count":   len(artworks),
    }


# ─── Error handlers ───────────────────────────────────────────────────────────

@app.exception_handler(httpx.HTTPStatusError)
async def httpx_status_error(request, exc):
    return JSONResponse(
        status_code=503,
        content={"detail": f"Knowledge graph error: {exc.response.status_code}"},
    )


@app.exception_handler(httpx.RequestError)
async def httpx_request_error(request, exc):
    return JSONResponse(
        status_code=503,
        content={"detail": "Knowledge graph unreachable — Fuseki가 실행 중인지 확인하세요"},
    )


# ─── Static / SPA ─────────────────────────────────────────────────────────────

if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if not full_path.startswith("api/"):
            idx = os.path.join(FRONTEND_DIR, "index.html")
            if os.path.exists(idx):
                return FileResponse(idx)
        raise HTTPException(404)
else:
    @app.get("/")
    async def api_root():
        return {"message": "Art Auction API", "docs": "/docs"}
