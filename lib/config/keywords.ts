/**
 * 키워드 / 트리거 사전
 *
 * 자막 강조, 스포트라이트, 팝업, B-roll 카테고리 매칭에 사용된다.
 * 비즈니스(세무/정책자금) 유튜브 톤에 맞춘 기본값이며,
 * 나중에 사용자 설정 UI 로 쉽게 확장할 수 있도록 한 곳에 모아둔다.
 */

import type { BrollCategory } from "@/lib/types";

/** 4. 자막에서 자동 강조할 핵심 키워드 */
export const EMPHASIS_KEYWORDS: string[] = [
  "법인세",
  "정책자금",
  "고용지원금",
  "세액공제",
  "감면",
  "대표님",
  "놓치면",
  "위험",
  "환급",
  "절세",
  "지원금",
  "3000만원",
  "5000만원",
  "1억",
];

/** 6. 스포트라이트를 발동시키는 "중요 문장" 트리거 */
export const SPOTLIGHT_TRIGGERS: string[] = [
  "중요합니다",
  "여기 보세요",
  "놓치면",
  "반드시",
  "핵심은",
  "결론은",
  "대표님들이 많이",
  "이거 모르면",
];

/**
 * 8. 팝업 텍스트 트리거.
 * 금액/숫자/위험 단어가 나오면 짧게 팝업을 띄운다.
 */
export interface PopupRule {
  /** 문장에서 찾을 정규식 */
  pattern: RegExp;
  /** 팝업에 표시할 텍스트(매칭 그룹으로 치환 가능). 함수면 매칭 결과로 생성 */
  render: (match: RegExpMatchArray) => string;
  style: "amount" | "warning" | "check";
}

export const POPUP_RULES: PopupRule[] = [
  // 금액 표현: "3000만원", "3,000만원", "5000 만원" 등
  {
    pattern: /([0-9]{1,3}(?:,?[0-9]{3})*)\s*만원/,
    render: (m) => `${formatKoreanAmount(m[1])}만원`,
    style: "amount",
  },
  // 억 단위 금액: "1억", "2억 5천"
  {
    pattern: /([0-9]+)\s*억/,
    render: (m) => `${m[1]}억`,
    style: "amount",
  },
  // 위험/손해 경고
  {
    pattern: /(놓치면|위험|손해|과태료|가산세)/,
    render: () => "놓치면 손해",
    style: "warning",
  },
  // 대표님 필수 체크
  {
    pattern: /(대표님|사업자|법인)/,
    render: () => "대표님 필수 체크",
    style: "check",
  },
];

/** 금액 문자열에 천 단위 콤마를 넣어 보기 좋게 만든다. */
function formatKoreanAmount(raw: string): string {
  const digits = raw.replace(/,/g, "");
  if (!/^\d+$/.test(digits)) return raw;
  return Number(digits).toLocaleString("ko-KR");
}

/**
 * 7. B-roll 카테고리 매칭 사전.
 * transcript 문장에 아래 키워드가 들어가면 해당 카테고리를 추천한다.
 * 배열 순서 = 우선순위.
 */
export const BROLL_CATEGORY_KEYWORDS: Array<{
  categories: BrollCategory[];
  keywords: string[];
}> = [
  // 위험/주의 신호가 최우선(놓치면·불이익 등은 강한 신호)
  {
    categories: ["warning", "checklist"],
    keywords: ["위험", "놓치면", "불이익", "주의", "손해", "과태료", "가산세", "실수", "함정"],
  },
  {
    categories: ["government", "money"],
    keywords: ["정책자금", "지원금", "고용지원금", "정부", "소상공인", "융자", "보조금", "지원사업"],
  },
  {
    categories: ["tax", "document"],
    keywords: ["법인세", "세액공제", "절세", "감면", "세금", "환급", "신고", "부가세", "종합소득세"],
  },
  {
    categories: ["business_owner", "office"],
    keywords: ["대표님", "사업자", "사장님", "법인", "회사", "창업", "직원", "임직원"],
  },
  {
    categories: ["meeting", "document"],
    keywords: ["계약", "상담", "미팅", "회의", "문의", "예약", "컨설팅", "검토"],
  },
  {
    categories: ["checklist", "document"],
    keywords: ["체크", "확인", "준비물", "서류", "요건", "조건", "절차", "단계"],
  },
  {
    categories: ["money", "document"],
    keywords: ["매출", "비용", "수익", "통장", "현금", "자금", "이익", "원가"],
  },
];

/**
 * 문장에서 매칭되는 B-roll 카테고리를 우선순위대로 반환한다.
 * 여러 규칙이 매칭되면 앞선(더 강한) 규칙의 카테고리를 우선하되,
 * 뒤 규칙의 대표 카테고리도 후보로 덧붙여 다양성을 확보한다.
 */
export function matchBrollCategories(text: string): {
  categories: BrollCategory[];
  matchedKeyword: string | null;
} {
  const hits: Array<{ cat: BrollCategory; keyword: string }> = [];
  for (const rule of BROLL_CATEGORY_KEYWORDS) {
    const hit = rule.keywords.find((k) => text.includes(k));
    if (hit) {
      for (const c of rule.categories) hits.push({ cat: c, keyword: hit });
    }
  }
  if (hits.length === 0) {
    return { categories: ["office", "business_owner"], matchedKeyword: null };
  }
  // 중복 제거(순서 유지)
  const seen = new Set<BrollCategory>();
  const categories: BrollCategory[] = [];
  for (const h of hits) {
    if (!seen.has(h.cat)) {
      seen.add(h.cat);
      categories.push(h.cat);
    }
  }
  return { categories, matchedKeyword: hits[0].keyword };
}
