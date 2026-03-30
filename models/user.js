const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const passportLocalMongoose = require('passport-local-mongoose');

const UserSchema = new Schema({
    email: {
        type: String,
        require: true,
        unique: true
    },
    enrolledCourses: {
        type: [Schema.Types.Mixed],
        default: []
    }
})

UserSchema.methods.getEnrolledCourseIdSet = function() {
    const ids = (this.enrolledCourses || []).map((entry) => {
        if (!entry) return null;

        if (entry.courseId) {
            return String(entry.courseId);
        }

        // Backward compatibility in case some old documents still have raw ObjectId values.
        if (entry._bsontype === 'ObjectId' || typeof entry === 'string') {
            return String(entry);
        }

        return null;
    }).filter(Boolean);

    return new Set(ids);
};

UserSchema.methods.findEnrollment = function(courseId) {
    const target = String(courseId);

    return (this.enrolledCourses || []).find((entry) => {
        if (!entry) return false;

        if (entry.courseId) return String(entry.courseId) === target;
        return String(entry) === target;
    });
};

UserSchema.pre('save', function(next) {
    if (!Array.isArray(this.enrolledCourses)) {
        this.enrolledCourses = [];
        return next();
    }

    this.enrolledCourses = this.enrolledCourses.map((entry) => {
        if (!entry) return entry;

        if (entry.courseId) return entry;

        if (entry._bsontype === 'ObjectId' || typeof entry === 'string') {
            return {
                courseId: entry,
                progress: {
                    completedCount: 0,
                    lastLessonId: ''
                },
                lastSeenUpdatedAt: null,
                enrolledAt: new Date()
            };
        }

        return entry;
    });

    next();
});

UserSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model('User', UserSchema);