import { Injectable } from '@nestjs/common';
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

@Injectable()
export class AiService {
    createEmbedding(text: string) {
        const cleanSpaces = text.replace(/\s+/g, ' ').trim();

        const embeddings = new OpenAIEmbeddings({
            apiKey: process.env.OPENAI_API_KEY,
            model: 'text-embedding-3-small'
        });

        const vector = embeddings.embedQuery(cleanSpaces);

        return vector;
    }

    async generateInsight(data: string) {
        const llm = new ChatOpenAI({
            model: 'gpt-4o-mini',
            temperature: 0
        });

        const systemMsg = new SystemMessage("You're an experienced running coach, so you need to analyze user data and provide your feedback on it.");
        const humanMsg = new HumanMessage(data);

        const messages = [systemMsg, humanMsg];

        const insight = await llm.invoke(messages);

        return insight.content as string;
    }
}
