const SAMPLE_TEXT = "本项目采用氮化镓材料，覆盖国产纤维改性、树脂体系优化和内胆成型关键工艺。";

function result(query: string, index: number) {
  return {
    doc_id: "mock-doc-001",
    file_name: "标准样本.pdf",
    page: 5 + index,
    block_id: `block-${String(index + 18).padStart(3, "0")}`,
    section: index === 0 ? "技术方案" : "项目信息",
    text: SAMPLE_TEXT,
    highlight: {
      start: SAMPLE_TEXT.indexOf(query) >= 0 ? SAMPLE_TEXT.indexOf(query) : 0,
      end: SAMPLE_TEXT.indexOf(query) >= 0 ? SAMPLE_TEXT.indexOf(query) + query.length : query.length,
    },
    bbox: [120, 330 + index * 40, 430, 380 + index * 40],
    score: 0.98 - index * 0.03,
  };
}

export function mockSearch(query: string, topK = 10) {
  const count = Math.max(1, Math.min(topK, 3));
  return {
    query,
    results: Array.from({ length: count }, (_, index) => result(query, index)),
  };
}

export function mockBlock(docId: string, blockId: string) {
  return {
    doc_id: docId,
    block_id: blockId,
    page: 5,
    section: "技术方案",
    text: SAMPLE_TEXT,
    bbox: [120, 330, 430, 380],
  };
}

export function mockPage(docId: string, page: number) {
  return {
    doc_id: docId,
    page,
    image_url: `/mock-pages/${docId}/${page}.png`,
    bbox: [120, 330, 430, 380],
  };
}

export function mockReview(fileName: string) {
  return {
    task_id: `mock-review-${Date.now()}`,
    status: "done",
    file_name: fileName,
    issues: [
      {
        type: "data_inconsistency",
        page: 6,
        block_id: "block-024",
        source_text: "近两年国内市场占有率达36.8%",
        evidence_text: "近两年在国内市场占有率达36.2%",
        suggestion: "36.2%",
        reason: "同一指标的数值不一致",
        confidence: 0.93,
      },
    ],
  };
}
