const mongoose = require('mongoose');

const videoModelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    developer: {
        type: String,
        required: true
    },
    website: {
        type: String,
        required: true
    },
    pricing: {
        type: String,
        enum: ['Free', 'Freemium', 'Paid', 'Enterprise'],
        default: 'Freemium'
    },
    features: [{
        type: String
    }],
    imageUrl: {
        type: String,
        default: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=400'
    },
    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 4.0
    },
    releaseYear: {
        type: Number,
        default: 2024
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model('VideoModel', videoModelSchema);
