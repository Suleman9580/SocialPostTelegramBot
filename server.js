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






bot.start(async (ctx) => {

    const from = ctx.update.message.from;
    

    try {
        
        await userModel.findOneAndUpdate({tgId: from.id},{
            $setOnInsert: {
                firstname: from.first_name,
                lastname: from.last_name,
                username: from.username,
                isBot: from.is_bot,
            }
        }, { upsert: true, new: true });


        await ctx.reply(`👋 Welcome! ${from.first_name} 
I'm your Social Media Post Bot 🤖 Just share what you're up to during the day—meetings, wins, thoughts, anything—and I’ll turn it into scroll-stopping posts for:
    🔹 LinkedIn
    🔹 Twitter (X)
    🔹 Facebook
Let’s boost your Social Media presence. Ready to start?`)

  
    } catch (error) {
        console.error('Error processing start command:', error);
        await ctx.reply('An error occurred while processing your request.');       
    }
});


bot.command('generate', async(ctx) => {

    const from = ctx.update.message.from;

    // waiting message which is going to be delete
    const {message_id: stickerId} = await ctx.replyWithSticker("CAACAgQAAxkBAAOQaFMJ4JIaFdz0K20PIvDYCtiz5BoAApwRAAJGpOFRkTuS3L4QYSc2BA");
    const {message_id: waitingMessageId} = await ctx.reply("Generating your post... Please wait a moment. ⏳");

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);


    const event = await eventModel.find({
        tgId: from.id,
        createdAt: {
            $gte: startOfDay,
            $lte: endOfDay
        }
    })

    // console.log(event)

    if(event.length === 0) {
        // delete waiting message
        await ctx.deleteMessage(waitingMessageId);
        await ctx.deleteMessage(stickerId);

        // send reply
        return ctx.reply("No events found for today. Please send your daily updates before generating a post.");
    }

    // console.log("events", event)

    // Make openai Api Call

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
                    content: `write like a human, for humans, craft three engaging socialmedia posts for linkedIn, Twitter (X) and facebook audiences, use simple language. use given time labels just to understand the order of the events. don't mention the time in the posts. Each posts should creatively highlights the following events. Ensure the tone is conversational and impactfull. Focus on engaging the respective platform's audience.
                    don't share unnecessary things just share things which anyone can just copy and paste. Add some emojis for more user attention, encourage interaction, sharing and driving interest in the events: ${event.map((event) => event.text).join(', ')}. The format should look like this:
                    🔹 LinkedIn Post:
                    -Generated LinkedIn post here.
                    🔹 Twitter(X) Post:
                    -Generated Twitter post here.
                    🔹 Facebook Post:
                    -Generated Facebook post here.
                    `
                }
            ]
        })

        // console.log("chatCompletion", chatCompletion)

        // store token count
        await userModel.findOneAndUpdate({
            tgId: from.id,
        },
    {
        $inc: {
            promptTokens: chatCompletion.usage.prompt_tokens,
            completionTokens: chatCompletion.usage.completion_tokens,
            totalTokens: chatCompletion.usage.total_tokens
        }
    })


        //delete waiting message before sending the reply
        await ctx.deleteMessage(waitingMessageId);
        await ctx.deleteMessage(stickerId);
        // send the reply
        await ctx.reply(chatCompletion.choices[0].message.content);


    } catch (error) {
        console.log(error)
    }


})

// bot.on(message('sticker'), (ctx) => {
//     console.log("sticker", ctx.update.message);
// } )

bot.help((ctx) => {
    const from = ctx.update.message.from;
    ctx.reply(`👋 Welcome! ${from.first_name} to the Help Section! Feel free to contact
suleman.techworks@gmail.com for any kind of query`)
});


bot.on(message('text'), async(ctx)=> {

    const from = ctx.update.message.from;
    const message = ctx.update.message.text

    try {
        await eventModel.create({
            text: message,
            tgId: from.id
        })
        ctx.reply("Got it! Keep sending your daily updates — To Generate the post, just enter the command: /generate");


    } catch (error) {
        console.log(error)
        ctx.reply("An error occurred while processing your message. Please try again later.");
    }    


})



bot.launch()

process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});