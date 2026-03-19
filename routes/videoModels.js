const express = require("express")
const router = express.Router()
const VideoModel = require("../models/videoModel")

// Get all video models
router.get("/", async (req, res) => {
    try {
        const videoModels = await VideoModel.find({ isActive: true }).sort({ rating: -1 });
        
        // If no models in database, use default data
        if (videoModels.length === 0) {
            const defaultModels = [
                {
                    name: "Sora",
                    description: "OpenAI's text-to-video model capable of generating realistic and imaginative videos from text descriptions up to minute-long videos.",
                    developer: "OpenAI",
                    website: "https://openai.com/sora",
                    pricing: "Enterprise",
                    features: ["Text to Video", "Image to Video", "Video Extension", "Complex Scene Generation"],
                    rating: 4.8,
                    releaseYear: 2024,
                    imageUrl: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=400"
                },
                {
                    name: "Runway Gen-3 Alpha",
                    description: "Next-generation AI video generation model with improved consistency, motion quality, and cinematic controls.",
                    developer: "Runway",
                    website: "https://runwayml.com/",
                    pricing: "Freemium",
                    features: ["Text to Video", "Image to Video", "Video Editing", "Motion Brush", "Gen-3 Alpha"],
                    rating: 4.7,
                    releaseYear: 2024,
                    imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400"
                },
                {
                    name: "Pika Labs",
                    description: "AI-powered video creation platform that generates videos from text, images, and existing video content.",
                    developer: "Pika Labs",
                    website: "https://pika.art/",
                    pricing: "Freemium",
                    features: ["Text to Video", "Image to Video", "Video to Video", "Sound Effects"],
                    rating: 4.5,
                    releaseYear: 2023,
                    imageUrl: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400"
                },
                {
                    name: "Luma Dream Machine",
                    description: "Rapid AI video generation from images and text with focus on physics-based realism and character consistency.",
                    developer: "Luma AI",
                    website: "https://lumalabs.ai/dream-machine",
                    pricing: "Freemium",
                    features: ["Image to Video", "Text to Video", "60fps Support", "Character Consistency"],
                    rating: 4.6,
                    releaseYear: 2024,
                    imageUrl: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400"
                },
                {
                    name: "Kling AI",
                    description: "Full-stack AI video generation platform offering high-quality video creation with cinematic controls.",
                    developer: "Kuaishou",
                    website: "https://kling.ai/",
                    pricing: "Freemium",
                    features: ["Text to Video", "Image to Video", "Video Extension", "2K Resolution"],
                    rating: 4.4,
                    releaseYear: 2024,
                    imageUrl: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400"
                },
                {
                    name: "Haiper",
                    description: "Perception-focused AI video generation with emphasis on motion dynamics and visual perception.",
                    developer: "Haiper",
                    website: "https://haiper.ai/",
                    pricing: "Free",
                    features: ["Text to Video", "Image to Video", "Video Remixing", "Magic Paint"],
                    rating: 4.3,
                    releaseYear: 2024,
                    imageUrl: "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=400"
                },
                {
                    name: "Meta Movie Gen",
                    description: "Meta's AI media generation model for creating high-quality video and audio content from text prompts.",
                    developer: "Meta AI",
                    website: "https://ai.meta.com/",
                    pricing: "Free",
                    features: ["Text to Video", "Audio Generation", "Video Editing", "Personalized Video"],
                    rating: 4.5,
                    releaseYear: 2024,
                    imageUrl: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400"
                },
                {
                    name: "Stable Video Diffusion",
                    description: "Stability AI's open-source video generation model enabling community-driven AI video development.",
                    developer: "Stability AI",
                    website: "https://stability.ai/",
                    pricing: "Free",
                    features: ["Open Source", "Text to Video", "Image to Video", "Custom Fine-tuning"],
                    rating: 4.2,
                    releaseYear: 2024,
                    imageUrl: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=400"
                }
            ];
            
            await VideoModel.insertMany(defaultModels);
            const freshModels = await VideoModel.find({ isActive: true }).sort({ rating: -1 });
            return res.render('videoModels/index', { videoModels: freshModels });
        }
        
        res.render('videoModels/index', { videoModels });
    } catch (err) {
        console.log(err);
        res.status(500).send("Error loading video models");
    }
});

// Get single video model details
router.get("/:id", async (req, res) => {
    try {
        const videoModel = await VideoModel.findById(req.params.id);
        if (!videoModel) {
            return res.status(404).send("Model not found");
        }
        res.render('videoModels/show', { videoModel });
    } catch (err) {
        console.log(err);
        res.status(500).send("Error loading model details");
    }
});

module.exports = router;
