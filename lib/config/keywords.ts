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
  {
    categories: ["government", "money"],
    keywords: ["정책자금", "지원금", "고용지원금", "정부", "지원", "융자"],
  },
  {
    categories: ["tax", "document"],
    keywords: ["법인세", "세금", "절세", "세액공제", "감면", "환급", "신고"],
  },
  {
    categories: ["business_owner", "office"],
    keywords: ["대표님", "사업자", "법인", "회사", "창업", "직원"],
  },
  {
    categories: ["meeting", "office"],
    keywords: ["상담", "계약", "미팅", "회의", "문의", "예약"],
  },
  {
    categories: ["money", "document"],
    keywords: ["매출", "비용", "수익", "통장", "현금", "자금"],
  },
];

/** 문장에서 매칭되는 B-roll 카테고리를 우선순위대로 반환한다. */
export function matchBrollCategories(text: string): {
  categories: BrollCategory[];
  matchedKeyword: string | null;
} {
  for (const rule of BROLL_CATEGORY_KEYWORDS) {
    const hit = rule.keywords.find((k) => text.includes(k));
    if (hit) {
      return { categories: rule.categories, matchedKeyword: hit };
    }
  }
  // 아무 것도 매칭 안 되면 무난한 기본값
  return { categories: ["office", "business_owner"], matchedKeyword: null };
}
