---
name: image-cognition
description: "[에이전트 전용] Image Cognition 에이전트가 내부 호출하는 이미지 분석 스킬. 사용자 직접 요청은 art-auction-orchestrator로 처리한다. 작품 이미지에서 색감 팔레트(주조색·온도·채도), 화풍·미술 사조, 제작 시대, 구도, 기법을 분석하고 온톨로지 매핑 데이터를 생성한다."
---

# Image Cognition Skill

미술품 이미지의 다차원 시각 분석을 수행하고 온톨로지 연결 데이터를 생성하는 스킬.

## 분석 파이프라인

```
[이미지 입력]
     ↓
[전처리] — 해상도 확인, 포맷 정규화
     ↓
[병렬 분석]
  ├── 색감 분석
  ├── 화풍/사조 분류
  ├── 시대 추정
  ├── 구도 분석
  └── 기법 식별
     ↓
[온톨로지 매핑]
     ↓
[결과 구조화]
```

## 색감 분석

색감은 경매 플랫폼의 핵심 검색 차원이다. 정확한 색 데이터가 GraphRAG 쿼리의 정밀도를 결정한다.

**추출 항목:**
```json
{
  "dominant_colors": [
    {"hex": "#4A7FA5", "name": "steel blue", "hsl": [207, 37, 47], "percentage": 0.34},
    {"hex": "#D4A853", "name": "golden amber", "hsl": [38, 58, 58], "percentage": 0.28}
  ],
  "temperature": "cool",       // warm | cool | neutral
  "saturation": "medium",      // low | medium | high
  "brightness": "high",        // low | medium | high
  "contrast": "high"           // low | medium | high
}
```

**온도 분류 기준:**
- warm: 빨강/주황/노랑 계열이 전체 픽셀의 40% 이상
- cool: 파랑/초록/보라 계열이 전체 픽셀의 40% 이상
- neutral: 어느 계열도 40%를 넘지 않거나 무채색 위주

## 화풍 및 사조 분류

**지원 사조 목록:**
```
Renaissance, Baroque, Rococo, Neoclassicism, Romanticism,
Realism, Impressionism, Post-Impressionism, Fauvism,
Expressionism, Cubism, Surrealism, Abstract Expressionism,
Pop Art, Minimalism, Contemporary, Korean Traditional (한국 전통화)
```

**분류 결과 형식:**
```json
{
  "primary_movement": "Impressionism",
  "confidence": 0.87,
  "evidence": [
    "짧고 굵은 붓 터치로 빛의 순간적 인상 포착",
    "혼색보다 순색 병치 기법 사용",
    "실외 자연광 표현"
  ],
  "secondary_movement": "Post-Impressionism",
  "secondary_confidence": 0.31
}
```

신뢰도 0.5 미만 결과는 반드시 "불확실" 태그를 붙인다.

## 시대 추정

작품 스타일과 시각적 단서를 종합하여 제작 시대를 추정한다.

**추정 근거 우선순위:**
1. 화풍/사조의 역사적 시기 (가중치 높음)
2. 캔버스/지지체 특성 (이미지로 확인 가능한 경우)
3. 프레임 스타일 (이미지에 포함된 경우)
4. 서명/날짜 (텍스트 인식으로 확인)

```json
{
  "estimated_decade": "1890s",
  "confidence_interval": {"from": "1885", "to": "1905"},
  "confidence": 0.72,
  "basis": ["인상주의 전성기와 일치하는 기법", "캔버스 텍스처 패턴"]
}
```

## 구도 분석

```json
{
  "focal_point": {"x": 0.40, "y": 0.35},     // 0~1 정규화 좌표
  "symmetry": "asymmetric",                   // symmetric | asymmetric | radial
  "rule_of_thirds": true,                     // 3등분 법칙 적용 여부
  "complexity": "medium",                     // low | medium | high
  "depth": "three_plane"                      // flat | two_plane | three_plane
}
```

## 기법 식별

```json
{
  "medium": "oil_on_canvas",
  "brushwork": "loose_impasto",      // precise | loose | impasto | flat | gestural
  "texture": "rough",                // smooth | medium | rough
  "layering": "multi_layer"          // single | multi_layer
}
```

## 온톨로지 매핑 출력

분석 완료 후 온톨로지 속성에 직접 매핑할 수 있는 형식으로 변환한다.
GraphRAG가 이 데이터를 받아 SPARQL 쿼리를 생성할 수 있다.

```json
{
  "ontology_mappings": {
    "artwork:temperature":          "cool",
    "artwork:saturation":           "medium",
    "artwork:primaryColorHex":      "#4A7FA5",
    "artwork:belongsToMovement":    "artwork:Impressionism",
    "artwork:estimatedDecade":      "artwork:Period_1890s",
    "artwork:medium":               "artwork:OilOnCanvas",
    "artwork:brushworkStyle":       "artwork:LooseImpasto"
  }
}
```

## 해상도 및 품질 처리

| 해상도 | 가능한 분석 |
|--------|-----------|
| 1000px 이상 | 전체 분석 (색감+화풍+시대+구도+기법) |
| 500~999px | 색감·화풍·시대 (구도·기법 정밀도 제한) |
| 500px 미만 | 색감만 신뢰 가능, 나머지는 "저해상도" 표시 |

저해상도 이미지는 분석을 중단하지 않는다. 신뢰 가능한 차원만 수행하고 나머지는 null과 함께 사유를 명시한다.
