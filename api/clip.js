const { GoogleGenerativeAI } = require('@google/generative-ai');
const { YoutubeTranscript } = require('youtube-transcript');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const { url, keyword } = req.body;

    if (!url || !keyword) {
        return res.status(400).json({ error: 'Input tidak lengkap!' });
    }

    try {
        const transkripRaw = await YoutubeTranscript.fetchTranscript(url);
        let teksTranskrip = transkripRaw.map(t => `[Detik ${Math.round(t.offset / 1000)}] ${t.text}`).join('\n');

        // Menggunakan library klasik yang lebih stabil
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        const prompt = `Berikut adalah transkrip video YouTube beserta detiknya:\n${teksTranskrip}\nCari di detik ke berapa kalimat yang paling mirip dengan "${keyword}" diucapkan. Jawab HANYA dengan format JSON mentah: {"start": 120, "end": 135}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const timeline = JSON.parse(cleanText);

        return res.status(200).json({
            status: "success",
            start: timeline.start,
            end: timeline.end
        });

    } catch (error) {
        return res.status(500).json({ error: "Gagal memproses. Detail: " + error.message });
    }
}
