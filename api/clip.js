const { GoogleGenAI } = require('@google/genai');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const { url, keyword } = req.body;

    if (!url || !keyword) {
        return res.status(400).json({ error: 'Gagal memproses, input tidak lengkap!' });
    }

    try {
        // Menggunakan API Key Gemini asli yang disimpan di Vercel
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // Meminta Gemini menonton video via URL dan mencari kalimat spesifik
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash', // Model gratis dan mendukung input video panjang
            contents: [
                {
                    inlineData: {
                        mimeType: "video/mp4",
                        data: url
                    }
                },
                `Tonton video ini secara menyeluruh. Tolong deteksi pada detik ke berapa kalimat "${keyword}" diucapkan.
                Kamu harus merespons HANYA dengan format objek JSON mentah seperti contoh berikut tanpa tambahan teks narasi/markdown apa pun:
                {"start": 340, "end": 355}`
            ],
        });

        // Membersihkan text response jika ada sisa format markdown ```json ... ```
        let cleanText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const timeline = JSON.parse(cleanText);

        // Mengembalikan data detik akurat ke halaman website
        return res.status(200).json({
            status: "success",
            start: timeline.start,
            end: timeline.end
        });

    } catch (error) {
        return res.status(500).json({ error: "Gagal berdiskusi dengan Gemini API: " + error.message });
    }
}
