import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY) {
  console.warn("[Server] Warning: GEMINI_API_KEY is not set in environment variables.");
} else {
  console.log("[Server] GEMINI_API_KEY is configured (length: " + API_KEY.length + ")");
}

const app = express();
const PORT = 3000;

// Middleware
app.use((req, res, next) => {
  console.log(`[Server] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Debug route
app.get("/debug", (req, res) => {
  res.json({
    message: "Express is alive",
    env: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
    apiKeySet: !!API_KEY,
    headers: req.headers,
    url: req.url,
    method: req.method
  });
});

// Health check
app.get(["/api/health", "/health"], (req, res) => {
  res.json({ 
    status: "ok", 
    mode: process.env.NODE_ENV || "development",
    vercel: !!process.env.VERCEL,
    url: req.url
  });
});

// API routes
app.post(["/api/analyze", "/analyze"], async (req, res) => {
  console.log(`[Server] Analyze request received. Body size: ${JSON.stringify(req.body).length} bytes`);
  const { base64Image, mimeType } = req.body;

  if (!base64Image || !mimeType) {
    return res.status(400).json({ error: "缺少图片数据或 MIME 类型" });
  }

  if (!API_KEY || API_KEY === "MY_GEMINI_API_KEY") {
    return res.status(500).json({ error: "服务器端 API Key 未配置。请在 Vercel 环境变量中设置 GEMINI_API_KEY。" });
  }

  try {
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

    const modelsToTry = [
      "gemini-3-flash-preview",
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash",
      "gemini-1.5-pro-latest"
    ];

    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`[Server] Trying model: ${modelName}`);
        const response = await ai.models.generateContent({
          model: modelName,
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

        if (response.text) {
          console.log(`[Server] Success with model: ${modelName}`);
          return res.json(JSON.parse(response.text));
        }
      } catch (e: any) {
        console.warn(`[Server] Model ${modelName} failed:`, e.message);
        lastError = e;
        // If it's a quota or safety error, don't bother trying other models
        if (e.message && (e.message.includes("429") || e.message.includes("SAFETY"))) {
          break;
        }
        continue;
      }
    }

    const finalErrorMsg = lastError?.message || "所有尝试的模型均不可用";
    res.status(500).json({ error: `AI 分析失败: ${finalErrorMsg}` });
  } catch (err: any) {
    console.error("[Server] Unexpected error during analysis:", err);
    res.status(500).json({ error: `服务器内部错误: ${err.message}` });
  }
});

// Catch-all for API routes that are not found
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API 路径未找到: ${req.method} ${req.url}` });
});

// Development server setup
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const startDevServer = async () => {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`[Dev Server] Running on http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error("[Dev Server] Failed to start:", err);
    }
  };
  startDevServer();
}

export default app;
