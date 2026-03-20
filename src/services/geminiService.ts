import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY || "";

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
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const prompt = `
    你是一名资深的乳腺放射科专家。请分析这张乳腺钼靶（Mammography）照片。
    
    1. 请从以下维度进行详细评估：乳腺密度、肿块（形状/边缘/密度）、钙化（形态/分布）、结构扭曲、不对称、皮肤/乳头情况。
    2. 给出 BI-RADS 分级建议（0-6类）和诊断意见。
    3. **关键任务**：识别图中所有可疑的恶性结节或病灶，并提供它们的归一化坐标 [ymin, xmin, ymax, xmax]（范围 0-1000）。
    
    请以 JSON 格式返回结果，包含 'report' (Markdown 格式的详细报告) 和 'lesions' (包含坐标和标签的数组)。
  `;

  const imagePart = {
    inlineData: {
      data: base64Image.split(",")[1],
      mimeType: mimeType,
    },
  };

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: { parts: [imagePart, { text: prompt }] },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          report: { type: Type.STRING, description: "Markdown formatted medical report" },
          lesions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                box_2d: { 
                  type: Type.ARRAY, 
                  items: { type: Type.NUMBER },
                  description: "[ymin, xmin, ymax, xmax] normalized 0-1000"
                },
                label: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              },
              required: ["box_2d", "label"]
            }
          }
        },
        required: ["report", "lesions"]
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse AI response as JSON", e);
    return { report: response.text || "解析失败", lesions: [] };
  }
};
