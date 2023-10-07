const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
const crypto = require("crypto");
const line = require('@line/bot-sdk');

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const config = {
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: LINE_CHANNEL_SECRET
};

// LINE Client
const client = new line.Client(config);

//Azure OpenAI Client
const AZ_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AZ_OPENAI_ENDPOINT = process.env.OPENAI_ENDPOINT;
const modelName = process.env.OPENAI_DEPLOYMENT_NAME || "gpt-35-turbo";

if(!AZ_OPENAI_API_KEY || !AZ_OPENAI_ENDPOINT){
    throw new Error("Missing required configuration values.");
}

const openaiClient = new OpenAIClient(AZ_OPENAI_ENDPOINT, new AzureKeyCredential(AZ_OPENAI_API_KEY));

module.exports = async function (context, req) {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    
    //Test
    if (req.method === "GET") {
        context.res = {
            headers,
            body: "Hello, world!",
            status: 200,
        };
        return;
    }

    if(req.body["events"].length === 0){
        context.res = { status: 200, body: "Please pass a message on the query string or in the request body" };
        return;
    }

    
    if(req.body["events"][0].type !== "message" || req.body["events"][0].message.type !== "text"){
        message = {
            type: "text",
            text: "申し訳ありませんが、テキストメッセージのみ対応しております"
        };
        client.replyMessage(req.body["events"][0].replyToken, message);
        return;
    }
    
    if(!validate_signature(req.body, req.headers["x-line-signature"])){
        context.res = {
            status: 202,
            body: "fail to validate signature"
        };
        return;
    }
    
    try{
        const ans = await chatgpt(req.body["events"][0].message.text);
        message = { type: "text", text: ans };
        client.replyMessage(req.body["events"][0].replyToken, message);
        return;
    }catch(error){
        console.error(error);
        message = { type: "text", text: "申し訳ありませんが、エラーが発生しました" };
        client.replyMessage(req.body["events"][0].replyToken, message);
        return;
    }

};

//ChatGPT
const chatgpt = async (message) => {
    try{
        const messages = [
            { role: "system", content: "親切に丁寧に思いやりをもって返答してください" },
            { role: "user", content: message },
          ];

        const result = await openaiClient.getChatCompletions(modelName, messages);
        for (const choice of result.choices) {
            const response = choice.message.content || "...";
            return response;
          }
    }
    catch (error) {
        throw new Error(`OpenAI API Error: ${error.message}`);
    }
};

const validate_signature = (body, signature) => {
    try{
        const hash = crypto.createHmac("sha256", LINE_CHANNEL_SECRET).update(Buffer.from(JSON.stringify(body))).digest("base64");
        return hash === signature;
    }catch(e){
        console.log(e)
        return false;
    }
};