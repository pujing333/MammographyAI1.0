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

const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
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
  const { images } = req.body; // images: [{ base64, mimeType, view }]

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "缺少图片数据" });
  }

  if (!API_KEY || API_KEY === "MY_GEMINI_API_KEY") {
    return res.status(500).json({ error: "服务器端 API Key 未配置。请在 Vercel 环境变量中设置 GEMINI_API_KEY。" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    
    const prompt = `
      你是一名资深的乳腺放射科专家。请分析这组乳腺钼靶（Mammography）照片。
      这组照片包含同一个病例的不同体位（CC位和MLO位）以及不同对比度的影像。
      
      1. 请结合所有提供的影像进行综合评估：乳腺密度、肿块（形状/边缘/密度）、钙化（形态/分布）、结构扭曲、不对称、皮肤/乳头情况。
      2. 给出最终的 BI-RADS 分级建议（0-6类）和详细的诊断意见。
      3. **关键任务**：识别影像中所有可疑的恶性结节或病灶。
      4. 对于识别出的病灶，请提供它们在影像中的归一化坐标 [ymin, xmin, ymax, xmax]（范围 0-1000）。
      
      请以 JSON 格式返回结果，包含 'report' (Markdown 格式的详细报告) 和 'lesions' (包含坐标、标签和对应影像索引的数组)。
      JSON 结构示例：
      {
        "report": "...",
        "lesions": [
          { "box_2d": [ymin, xmin, ymax, xmax], "label": "肿块", "imageIndex": 0, "confidence": 0.9 }
        ]
      }
    `;

    const imageParts = images.map(img => ({
      inlineData: {
        data: img.base64.split(",")[1],
        mimeType: img.mimeType,
      },
    }));

    const modelsToTry = [
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-3.1-pro-preview",
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest"
    ];

    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`[Server] Trying model: ${modelName}`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts: [...imageParts, { text: prompt }] },
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
                      imageIndex: { type: Type.NUMBER, description: "Index of the image where the lesion is found" },
                      confidence: { type: Type.NUMBER }
                    },
                    required: ["box_2d", "label", "imageIndex"]
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

    // Extract message from lastError if it's a JSON string from the API
    let errorMsg = lastError?.message || "所有尝试的模型均不可用";
    try {
      const parsed = JSON.parse(errorMsg);
      if (parsed.error && parsed.error.message) {
        errorMsg = parsed.error.message;
      }
    } catch (e) {
      // Not JSON, keep as is
    }

    res.status(500).json({ error: errorMsg });
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
