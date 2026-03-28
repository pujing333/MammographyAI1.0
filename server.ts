import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.GEMINI_API_KEY || "";

const app = express();
const PORT = 3000;

async function startServer() {
  console.log(`[Server] Starting server in ${process.env.NODE_ENV || "development"} mode`);

  app.use((req, res, next) => {
    console.log(`[Server] Incoming request: ${req.method} ${req.url}`);
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // Debug route
  app.get("/debug", (req, res) => {
    res.json({
      message: "Express is alive",
      env: process.env.NODE_ENV,
      headers: req.headers,
      url: req.url
    });
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
  });

  // API routes
  app.post("/api/analyze", async (req, res) => {
    console.log(`[Server] Received analyze request: ${req.method} ${req.url}, Body size: ${JSON.stringify(req.body).length} bytes`);
    const { base64Image, mimeType } = req.body;

    if (!base64Image || !mimeType) {
      return res.status(400).json({ error: "缺少图片数据或 MIME 类型" });
    }

    if (!API_KEY || API_KEY === "MY_GEMINI_API_KEY") {
      return res.status(500).json({ error: "服务器端 API Key 未配置。请在环境变量中设置 GEMINI_API_KEY。" });
    }

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
        console.log(`[Server] 正在尝试使用模型: ${modelName}`);
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
          return res.json(JSON.parse(response.text));
        }
      } catch (e: any) {
        console.warn(`[Server] 模型 ${modelName} 调用失败:`, e.message);
        lastError = e;
        if (e.message && !e.message.includes("404") && !e.message.includes("not found")) {
          break;
        }
        continue;
      }
    }

    const finalErrorMsg = lastError?.message || "所有尝试的模型均不可用";
    res.status(500).json({ error: `AI 分析失败: ${finalErrorMsg}` });
  });

  // Catch-all for API routes that are not found
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API 路径未找到: ${req.method} ${req.url}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only listen if not running as a Vercel function
  if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
