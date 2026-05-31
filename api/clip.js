const { GoogleGenerativeAI } = require('@google/generative-ai');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { url, keyword } = req.body;
    if (!url || !keyword) return res.status(400).json({ error: 'Input tidak lengkap' });

    try {
        // 1. Mengekstrak ID Video secara otomatis dari link yang dimasukkan
        let videoId = '';
        if (url.includes('v=')) {
            videoId = url.split('v=')[1].split('&')[0];
        } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0];
        }
        if (!videoId) return res.status(400).json({ error: 'Format URL YouTube tidak valid' });

        // 2. Menggunakan "Jalan Belakang" via Piped API (Tembus Blokir Anti-Bot YouTube)
        const pipedRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
        const pipedData = await pipedRes.json();

        // Cek apakah sistem berhasil menemukan daftar subtitle
        if (!pipedData.subtitles || pipedData.subtitles.length === 0) {
            return res.status(400).json({ error: 'Video ini murni tidak memiliki Subtitle/CC.' });
        }

        // 3. Mengambil file mentah subtitle (format .vtt)
        const subUrl = pipedData.subtitles[0].url;
        const vttRes = await fetch(subUrl);
        let teksTranskrip = await vttRes.text();
        
        // Membatasi panjang karakter agar tidak meledakkan kuota baca Gemini
        teksTranskrip = teksTranskrip.substring(0, 50000); 

        // 4. Menugaskan AI Gemini untuk menganalisis dokumen teks tersebut
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Ini adalah file mentah subtitle video (.vtt):\n\n${teksTranskrip}\n\nCari pada detik ke berapa kalimat yang paling mirip dengan kata/kalimat "${keyword}" diucapkan. Jawab HANYA dengan format objek JSON mentah tanpa penjelasan atau teks markdown apapun seperti contoh ini:\n{"start": 12, "end": 15}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // 5. Membersihkan format agar website tidak kebingungan saat membacanya
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const timeline = JSON.parse(cleanText);

        return res.status(200).json({
            start: timeline.start,
            end: timeline.end
        });

    } catch (error) {
        return res.status(500).json({ error: "Gagal memproses AI: " + error.message });
    }
}
