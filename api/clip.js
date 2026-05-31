const { GoogleGenerativeAI } = require('@google/generative-ai');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { url, keyword } = req.body;
    if (!url || !keyword) return res.status(400).json({ error: 'Input tidak lengkap' });

    try {
        // 1. Ekstrak ID Video
        let videoId = '';
        if (url.includes('v=')) videoId = url.split('v=')[1].split('&')[0];
        else if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1].split('?')[0];
        
        if (!videoId) return res.status(400).json({ error: 'Format URL YouTube tidak valid' });

        // 2. Fetch Piped API dengan Pengaman
        const pipedRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
        if (!pipedRes.ok) {
            return res.status(500).json({ error: `Koneksi ke server bypass YouTube gagal (Status ${pipedRes.status}). Coba gunakan link video lain.` });
        }

        let pipedData;
        try {
            pipedData = await pipedRes.json();
        } catch (e) {
            return res.status(500).json({ error: 'Server bypass YouTube mengembalikan data kosong atau rusak.' });
        }

        if (!pipedData.subtitles || pipedData.subtitles.length === 0) {
            return res.status(400).json({ error: 'Video ini benar-benar tidak memiliki sistem Subtitle/CC.' });
        }

        // 3. Ambil teks Subtitle
        const subUrl = pipedData.subtitles[0].url;
        const vttRes = await fetch(subUrl);
        let teksTranskrip = await vttRes.text();
        teksTranskrip = teksTranskrip.substring(0, 45000); // Batas aman kuota karakter

        // 4. Perintah (Prompt) ketat ke Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Ini adalah file teks subtitle (.vtt):\n\n${teksTranskrip}\n\nTugas: Cari pada detik ke berapa kata/kalimat yang paling mirip dengan "${keyword}" diucapkan.\nATURAN MUTLAK:\n- Jika DITEMUKAN, jawab HANYA dengan JSON: {"start": angka_detik, "end": angka_detik}\n- Jika TIDAK DITEMUKAN, jawab HANYA dengan JSON: {"start": 0, "end": 0}\nJangan gunakan blok kode markdown, jangan ada kata pengantar, HANYA JSON.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // 5. Pembersihan & Pengaman Parsing JSON
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let timeline;
        try {
            timeline = JSON.parse(cleanText);
        } catch(e) {
            // Jika Gemini ngeyel dan menjawab dengan teks, kita tangkap di sini
            return res.status(500).json({ error: `AI memberikan respons di luar format: ${cleanText}` });
        }

        // 6. Logika jika kata tidak ada di video
        if (timeline.start === 0 && timeline.end === 0) {
            return res.status(404).json({ error: `Kata/kalimat "${keyword}" tidak diucapkan di dalam video ini.` });
        }

        return res.status(200).json({
            start: timeline.start,
            end: timeline.end
        });

    } catch (error) {
        return res.status(500).json({ error: "Sistem utama gagal: " + error.message });
    }
}
