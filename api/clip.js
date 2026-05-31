const axios = require('axios');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method tidak diizinkan' });
    }

    const { url, keyword } = req.body;

    try {
        // Di sini kita melempar tugas ke pihak ketiga yang kuat memproses video 50 menit
        // Contoh ini mensimulasikan panggilan ke API AI Video Editor (seperti Deepgram/Pipewing)
        const response = await axios.post('https://api.ai-video-processor.com/v1/auto-clip', {
            video_url: url,
            search_text: keyword,
            api_key: process.env.AI_SERVICE_KEY // Kita simpan rahasia API Key di Vercel
        });

        // Respons sukses dari server AI yang berisi link video hasil potongan pendek
        const dataHasil = response.data; 

        return res.status(200).json({
            status: "success",
            clipUrl: dataHasil.output_mp4_url // Link video vertikal siap tonton
        });

    } catch (error) {
        return res.status(500).json({ error: "Gagal memproses AI: " + error.message });
    }
}
