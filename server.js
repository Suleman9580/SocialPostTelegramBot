import {config} from 'dotenv';
config();
import {Telegraf} from 'telegraf';
import userModel from './src/models/User.model.js';
import connectDb from './src/config/db.js';
import {message} from 'telegraf/filters'
import eventModel from './src/models/Events.model.js';
import OpenAI from 'openai';


const bot = new Telegraf(process.env.BOT_TOKEN);
// console.log(process.env.BOT_TOKEN);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
});


try {
    await connectDb();
    console.log("database connected successfully");
} catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.kill(process.pid, 'SIGTERM');
}

// Ticker function to keep server active and send messages to inactive users
const startTicker = () => {
    setInterval(async () => {
        try {
            console.log('🕐 Ticker running - checking for inactive users...');
            
            // Find users who haven't been active in the last 1 day
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const inactiveUsers = await userModel.find({
                lastActivity: { $lt: oneDayAgo }
            });

            console.log(`Found ${inactiveUsers.length} inactive users`);

            // Send customized messages to inactive users
            for (const user of inactiveUsers) {
                try {
                    const messages = [
                        `Hey ${user.firstname}! 👋 Still thinking about your social media presence? Share what's on your mind today and I'll turn it into engaging posts! 📱✨`,
                        `Hi ${user.firstname}! 💭 Your social media audience is waiting for your next great post. What's happening in your world today? Let's create something amazing! 🚀`,
                        `Hello ${user.firstname}! 🌟 Don't let your social media momentum fade! Share your daily updates and I'll craft scroll-stopping content for you! 📈`,
                        `Hey there ${user.firstname}! 💡 Your next viral post is just a message away. What's your latest win or insight? Let's make it social media gold! 🏆`,
                        `Hi ${user.firstname}! 🎯 Ready to boost your online presence? Share your thoughts, meetings, or achievements - I'll transform them into engaging posts! 📊`
                    ];
                    
                    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
                    
                    await bot.telegram.sendMessage(user.tgId, randomMessage);
                    
                    // Update last activity to prevent spam
                    await userModel.findByIdAndUpdate(user._id, {
                        lastActivity: new Date()
                    });
                    
                    console.log(`Sent reminder to user ${user.firstname} (${user.tgId})`);
                    
                    // Add a small delay to avoid hitting rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    console.error(`Error sending message to user ${user.tgId}:`, error.message);
                }
            }
            
        } catch (error) {
            console.error('Error in ticker function:', error);
        }
    }, 10 *60 * 1000); // Run every 10 minutes
};

// Helper function to update user activity
const updateUserActivity = async (tgId) => {
    try {
        await userModel.findOneAndUpdate(
            { tgId: tgId },
            { lastActivity: new Date() }
        );
    } catch (error) {
        console.error('Error updating user activity:', error);
    }
};


bot.start(async (ctx) => {

    const from = ctx.update.message.from;   

    try {
        
        await userModel.findOneAndUpdate({tgId: from.id},{
            $setOnInsert: {
                firstname: from.first_name,
                lastname: from.last_name,
                username: from.username,
                isBot: from.is_bot,
            },
            $set: {
                lastActivity: new Date()
            }
        }, { upsert: true, new: true });


        await ctx.reply(`👋 Welcome! ${from.first_name} 
I'm your Social Media Post Bot 🤖 Just share what you're up to during the day—meetings, wins, thoughts, anything—and I'll turn it into scroll-stopping posts for:
    🔹 LinkedIn
    🔹 Twitter (X)
    🔹 Facebook
Let's boost your Social Media presence.
Ready to start?`)

  
    } catch (error) {
        console.error('Error processing start command:', error);
        await ctx.reply('An error occurred while processing your request.');       
    }
});


bot.command('generate', async (ctx) => {
    const from = ctx.update.message.from;
    
    // Update user activity
    await updateUserActivity(from.id);

    // Send both messages in parallel
    const [stickerMsg, waitingMsg] = await Promise.all([
        ctx.replyWithSticker("CAACAgQAAxkBAAOQaFMJ4JIaFdz0K20PIvDYCtiz5BoAApwRAAJGpOFRkTuS3L4QYSc2BA"),
        ctx.reply("Generating your post... Please wait a moment. ⏳")
    ]);
    const stickerId = stickerMsg.message_id;
    const waitingMessageId = waitingMsg.message_id;

    // Calculate day range once
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const endOfDay = new Date(now.setHours(23, 59, 59, 999));

    // Only fetch needed fields
    const events = await eventModel.find(
        { tgId: from.id, createdAt: { $gte: startOfDay, $lte: endOfDay } },
        { text: 1, _id: 0 }
    ).lean();

    if (!events.length) {
        await Promise.all([
            ctx.deleteMessage(waitingMessageId),
            ctx.deleteMessage(stickerId)
        ]);
        return ctx.reply("No events found for today. Please send your daily updates before generating a post.");
    }

    // Prepare prompt text
    const eventTexts = events.map(e => e.text).join(', ');

    try {
        const chatCompletion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL,
            messages: [
                {
                    role: "system",
                    content: "Act as a senior copywriter and social media expert. You write highly engaging and scroll-stopping posts for LinkedIn, Twitter (X), and Facebook. Using provided thoughts/event throughout the day."
                },
                {
                    role: 'user',
                    content: `write like a human, for humans, craft three engaging socialmedia posts for linkedIn, Twitter (X) and facebook audiences, use simple language. use given time labels just to understand the order of the events. don't mention the time in the posts. Each posts should creatively highlights the following events. Ensure the tone is conversational and impactfull. Focus on engaging the respective platform's audience. Also add some emojis for more user encourage interaction, sharing and driving interest in the events: ${eventTexts}.
                    the format of the response should be:
                    LinkedIn Post:
                    Twitter(X) Post:
                    Facebook Post:`
                }
            ]
        });

        // Update token usage in background (don't block user)
        userModel.findOneAndUpdate(
            { tgId: from.id },
            {
                $inc: {
                    promptTokens: chatCompletion.usage?.prompt_tokens || 0,
                    completionTokens: chatCompletion.usage?.completion_tokens || 0,
                    totalTokens: chatCompletion.usage?.total_tokens || 0
                }
            }
        ).exec();

        // Clean up messages in parallel
        await Promise.all([
            ctx.deleteMessage(waitingMessageId),
            ctx.deleteMessage(stickerId)
        ]);

        // Send generated post
        await ctx.reply(chatCompletion.choices[0]?.message?.content || "No content generated.");

    } catch (error) {
        await Promise.all([
            ctx.deleteMessage(waitingMessageId),
            ctx.deleteMessage(stickerId)
        ]);
        console.error('OpenAI API error:', error);
        await ctx.reply('An error occurred while generating your post. Please try again later.');
    }
})

// bot.on(message('sticker'), (ctx) => {
//     console.log("sticker", ctx.update.message);
// } )

bot.help(async (ctx) => {
    const from = ctx.update.message.from;
    
    // Update user activity
    await updateUserActivity(from.id);
    
    ctx.reply(`👋 Welcome! ${from.first_name} to the Help Section! Feel free to contact
suleman.techworks@gmail.com for any kind of query`)
});


bot.on(message('text'), async(ctx)=> {

    const from = ctx.update.message.from;
    const message = ctx.update.message.text

    try {
        // Update user activity
        await updateUserActivity(from.id);
        
        await eventModel.create({
            text: message,
            tgId: from.id
        })
        ctx.reply(`Got it! Keep sending your daily updates — To Generate the post, just enter the
            command: /generate`);


    } catch (error) {
        console.log(error)
        ctx.reply("An error occurred while processing your message. Please try again later.");
    }    


})

const PORT = process.env.PORT || 3000;
bot.launch();
console.log(`Bot started. Listening on port ${PORT}`);

// Start the ticker function
startTicker();
console.log('🕐 Ticker function started - will run every 10 minutes');

// Dummy HTTP server to keep Render happy
import http from 'http';
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!\n');
}).listen(PORT);



process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});