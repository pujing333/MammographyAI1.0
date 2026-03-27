export interface Lesion {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  label: string;
  confidence: number;
}

export interface AnalysisResult {
  report: string;
  lesions: Lesion[];
}

export const analyzeMammogram = async (base64Image: string, mimeType: string): Promise<AnalysisResult> => {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base64Image, mimeType }),
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      } else {
        const errorText = await response.text();
        console.error("非 JSON 错误响应:", errorText);
        throw new Error(`服务器返回错误 (${response.status}): ${errorText.slice(0, 100)}...`);
      }
    }

    return await response.json();
  } catch (error: any) {
    console.error("API 调用失败:", error);
    throw new Error(`AI 分析失败: ${error.message}。请检查网络连接或稍后重试。`);
  }
};
