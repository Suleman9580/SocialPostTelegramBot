import mongoose from "mongoose";


const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  tgId: {
    type: String,
    required: true,
    unique: true,
  },

  firstname: {
    type: String,
    required: true,
  },
  lastname: {
    type: String,
    required: true,
  },
  isBot: {
    type: Boolean,
    required: true,
  },

  promptToken: {
    type: Number,
    required: false,
  },

  completionToken: {
    type: Number,
    required: false,
  },
  
},
    {  timestamps: true,}
);

const User = mongoose.model("User", userSchema);

export default User;
