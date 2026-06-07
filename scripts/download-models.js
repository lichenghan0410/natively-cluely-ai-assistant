const path = require('path');
const fs = require('fs');

async function downloadModels() {
    const { pipeline, env } = await import('@huggingface/transformers');
    const modelsDir = path.join(__dirname, '../resources/models');
    
    // Ensure the directory exists
    if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
    }

    // Let Transformers.js handle the download but specify the local directory cache
    env.cacheDir = modelsDir;
    
    try {
        // 1. Embedding model (RAG) — multilingual-e5-small: Japanese-capable,
        //    384d (same as the prior all-MiniLM ⇒ no vec-table migration).
        //    dtype 'q8' matches LocalEmbeddingProvider so onnx/model_quantized.onnx
        //    (~112MB int8) is fetched instead of the 448MB fp32 weights.
        console.log('[download-models] Downloading Xenova/multilingual-e5-small (q8)...');
        await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });
        console.log('[download-models] multilingual-e5-small downloaded.');

        // 2. Zero-shot classification model (Intent Classifier)
        console.log('[download-models] Downloading Xenova/mobilebert-uncased-mnli...');
        await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
        console.log('[download-models] mobilebert-uncased-mnli downloaded.');

        console.log('[download-models] All models downloaded successfully!');
    } catch (e) {
        console.error('[download-models] Error downloading model:', e);
        process.exit(1);
    }
}

downloadModels().catch((e) => {
    console.error('[download-models] Fatal error:', e);
    process.exit(1);
});

