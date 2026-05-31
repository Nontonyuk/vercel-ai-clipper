const { GoogleGenerativeAI } = require('@google/generative-ai');
const { YoutubeTranscript } = require('youtube-transcript');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { url, keyword } = req.body;
    if (!url || !keyword) return res.status(400).json({ error: 'Input tidak lengkap' });

    try {
        // 1. Ambil transkrip dari YouTube
        const transkripRaw = await YoutubeTranscript.fetchTranscript(url);
        
        // Gabungkan teks dan batasi panjangnya agar AI tidak kewalahan (maksimal 50.000 karakter)
        let teksTranskrip = transkripRaw.map(t => `[Detik ${Math.round(t.offset / 1000)}] ${t.text}`).join('\n');
        teksTranskrip = teksTranskrip.substring(0, 50000); 

        // 2. Kirim ke Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Ini adalah transkrip video YouTube beserta detiknya:\n\n${teksTranskrip}\n\nCari di detik ke berapa kalimat yang paling mirip dengan "${keyword}" diucapkan. Jawab HANYA dengan format JSON mentah tanpa teks markdown apapun:\n{"start": 120, "end": 135}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // 3. Bersihkan respons menjadi JSON murni
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const timeline = JSON.parse(cleanText);

        return res.status(200).json({
            start: timeline.start,
            end: timeline.end
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
