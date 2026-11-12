const { GoogleGenAI } = require('@google/genai');
const logger = require('../core/logger').createServiceLogger('LLM');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');
const ai = require('./ai-provider');

class LLMService {
  constructor() {
    this.client = null;
    this.model = null;
    this.isInitialized = false;
    this.requestCount = 0;
    this.errorCount = 0;
    
    this.initializeClient();
  }

  initializeClient() {
    try {
      const electron=require('electron');
      if(electron.app?.getPath && !this._profiles){const Profiles=require('../core/ai-profiles');this._profiles=new Profiles(require('path').join(electron.app.getPath('userData'),'ai-profiles.json'),electron.safeStorage);}
      const legacy=config.getApiKey('GEMINI');
      if(this._profiles && legacy && !/^your[_-]/i.test(legacy) && Object.keys(this._profiles.public().profiles).length===0 && electron.safeStorage.isEncryptionAvailable())this._profiles.save({provider:'gemini',...ai.PRESETS.gemini,key:legacy});
      const selected=this.getProviderConfig();this.model=selected.model;
      this.isInitialized=!!selected.key || !!this._profiles?.public().profiles[selected.provider];
      this.client=selected.provider==='gemini'&&selected.key?new GoogleGenAI({apiKey:selected.key}):null;
    }catch(error){this.isInitialized=false;logger.warn('AI provider requires configuration',{error:error.message});}
  }

  getProviderConfig(draft) {
    if(this._profiles)return this._profiles.resolve(draft||{});
    return {provider:'gemini',...ai.PRESETS.gemini,model:this.model||config.get('llm.gemini.model'),key:config.getApiKey('GEMINI')||'',...draft};
  }

  getProviderSettings() {
    return this._profiles?.public()||{provider:'gemini',...ai.PRESETS.gemini,hasKey:!!config.getApiKey('GEMINI'),profiles:{}};
  }

  saveProviderConfig(draft) {
    if(!this._profiles)throw new Error('Provider settings are available in the desktop app.');
    const result=this._profiles.save(draft);this.initializeClient();return result;
  }

  async listProviderModels(draft) {
    return ai.listModels(this.getProviderConfig({...draft,model:draft?.model||'_models'}));
  }

  async testProviderConnection(draft,imageData) {
    const selected=this.getProviderConfig(draft);const started=Date.now();
    const parts=[{text:'Reply with only OK.'}];if(imageData)parts.push({inlineData:{mimeType:'image/png',data:imageData}});
    const response=await ai.generate(selected,{contents:[{role:'user',parts}]},null,{timeoutMs:30000});
    return {success:true,response,latency:Date.now()-started,provider:selected.provider,model:selected.model,imageAccepted:!!imageData};
  }

  getGenerationConfig(overrides = {}) {
    const defaults = config.get('llm.gemini.generation') || {};
    const fallback = {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
    };

    const merged = { ...fallback, ...defaults, ...overrides };
    return Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined && value !== null)
    );
  }

  applyGenerationDefaults(request, overrides = {}) {
    request.generationConfig = this.getGenerationConfig({ ...(request.generationConfig || {}), ...overrides });
    return request;
  }

  extractTextFromCandidates(response) {
    // New @google/genai SDK exposes response.text as a convenience getter.
    if (response && typeof response.text === 'string' && response.text.trim().length > 0) {
      return {
        text: response.text.trim(),
        candidate: response.candidates?.[0] || null,
        finishReason: response.candidates?.[0]?.finishReason || null
      };
    }

    const candidates = Array.isArray(response?.candidates)
      ? response.candidates
      : Array.isArray(response)
        ? response
        : [];

    if (!candidates.length) {
      throw new Error('No candidates in Gemini response');
    }

    const candidateWithText = candidates.find(candidate => {
      const parts = candidate?.content?.parts;
      return Array.isArray(parts) && parts.some(part => typeof part.text === 'string' && part.text.trim().length > 0);
    });

    if (!candidateWithText) {
      const finishReasons = candidates.map(c => c.finishReason || 'unknown').join(', ');
      throw new Error(`No text parts in candidates. Finish reasons: ${finishReasons}`);
    }

    const textParts = candidateWithText.content.parts
      .filter(part => typeof part.text === 'string' && part.text.trim().length > 0)
      .map(part => part.text.trim());

    if (!textParts.length) {
      throw new Error(`Candidate parts missing text after filtering: ${JSON.stringify(candidateWithText)}`);
    }

    const text = textParts.join('\n');

    return {
      text,
      candidate: candidateWithText,
      finishReason: candidateWithText.finishReason || null
    };
  }

  /**
   * Process an image directly with Gemini using the active skill prompt.
   * The image buffer is sent as inlineData alongside a concise instruction.
   * For image-based queries, we include the skill prompt (e.g., DSA) as systemInstruction.
   * @param {Buffer} imageBuffer - PNG/JPEG image bytes
   * @param {string} mimeType - e.g., 'image/png' or 'image/jpeg'
   * @param {string} activeSkill - current skill (e.g. 'dsa')
   * @param {Array} sessionMemory - optional (not required for image)
   * @param {string|null} programmingLanguage - optional language context for skills that need it
   * @returns {Promise<{response: string, metadata: object}>}
   */
  async processImageWithSkill(imageBuffer, mimeType, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('Choose your AI provider, endpoint, model and key in Settings.');
    }

    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('Invalid image buffer provided to processImageWithSkill');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      // Build system instruction using the skill prompt (with optional language injection)
      const { promptLoader } = require('../../prompt-loader');
const ai = require('./ai-provider');
      const skillPrompt = promptLoader.getSkillPrompt(activeSkill, programmingLanguage) || '';

      const request = this.buildImageRequest(imageBuffer, mimeType, activeSkill, programmingLanguage);

      // Execute with retries/timeout - try alternative method first for network reliability
      let responseText;
      const preferAlternative = !!config.get('llm.gemini.enableFallbackMethod');
      try {
        if (preferAlternative) {
          logger.debug('Attempting alternative HTTPS method first for reliability');
          responseText = await this.executeAlternativeRequest(request);
        } else {
          responseText = await this.executeRequest(request);
        }
      } catch (error) {
        const secondaryLabel = preferAlternative ? 'primary SDK method' : 'alternative HTTPS method';
        logger.warn(`${preferAlternative ? 'Alternative' : 'Primary'} method failed, trying ${secondaryLabel}`, { error: error.message });
        const secondaryFn = preferAlternative ? this.executeRequest.bind(this) : this.executeAlternativeRequest.bind(this);

        try {
          responseText = await secondaryFn(request);
        } catch (secondaryError) {
          logger.error('Both Gemini request methods failed', {
            firstError: error.message,
            secondError: secondaryError.message
          });
          throw secondaryError;
        }
      }

      // Enforce language in code fences if provided
      const finalResponse = programmingLanguage && promptLoader.normalizeSkillName(activeSkill) !== 'general'
        ? this.enforceProgrammingLanguage(responseText, programmingLanguage)
        : responseText;

      logger.logPerformance('LLM image processing', startTime, {
        activeSkill,
        imageSize: imageBuffer.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isImageAnalysis: true,
          mimeType
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM image processing failed', {
        error: error.message,
        activeSkill,
        requestId: this.requestCount
      });

      if (config.get('llm.gemini.fallbackEnabled')) {
        return this.generateFallbackResponse('[image]', activeSkill);
      }
      throw error;
    }
  }

  async processImageWithSkillStream(imageBuffer, mimeType, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null) {
    if (!this.isInitialized) {
      throw new Error('Choose your AI provider, endpoint, model and key in Settings.');
    }

    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('Invalid image buffer provided to processImageWithSkillStream');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      const geminiRequest = this.buildImageRequest(imageBuffer, mimeType, activeSkill, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      });

      const finalResponse = programmingLanguage && promptLoader.normalizeSkillName(activeSkill) !== 'general'
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

      logger.logPerformance('LLM image streaming', startTime, {
        activeSkill,
        imageSize: imageBuffer.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true,
          isImageAnalysis: true,
          mimeType
        }
      };
    } catch (error) {
      logger.warn('Streaming image analysis failed', {
        error: error.message,
        requestId: this.requestCount
      });
      throw error;
    }
  }

  buildImageRequest(imageBuffer, mimeType, activeSkill, programmingLanguage) {
    const sessionManager = require('../managers/session.manager');
    const history = sessionManager.getConversationHistory(10);
    const context = sessionManager.getSkillContext('general', programmingLanguage);
    const request = this.buildGeminiRequestWithHistory(this.formatImageInstruction('general', programmingLanguage), 'general', history, context, programmingLanguage);
    request.contents[request.contents.length - 1].parts.push({ inlineData: { data: imageBuffer.toString('base64'), mimeType } });
    return request;
  }

  formatImageInstruction(activeSkill, programmingLanguage) {
    return 'Read this screenshot and answer the visible question or task directly. Use the recent conversation if it explains what the user wants. For an error, explain it and suggest a useful next step; for a document or chart, explain the key point. If no task is apparent, briefly explain the main content. Keep it concise. Only write code if the visible task needs code; preserve any language shown. If a key detail is unreadable, ask one short clarifying question.';
  }

  async processTextWithSkill(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('Choose your AI provider, endpoint, model and key in Settings.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing text with LLM', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const geminiRequest = this.buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const preferAlternative = !!config.get('llm.gemini.enableFallbackMethod');
      let response;
      try {
        if (preferAlternative) {
          logger.debug('Attempting alternative HTTPS method first for text processing');
          response = await this.executeAlternativeRequest(geminiRequest);
        } else {
          response = await this.executeRequest(geminiRequest);
        }
      } catch (error) {
        const secondaryLabel = preferAlternative ? 'primary SDK method' : 'alternative HTTPS method';
        logger.warn(`${preferAlternative ? 'Alternative' : 'Primary'} method failed, trying ${secondaryLabel}`, {
          error: error.message,
          requestId: this.requestCount
        });
        const secondaryFn = preferAlternative ? this.executeRequest.bind(this) : this.executeAlternativeRequest.bind(this);
        try {
          response = await secondaryFn(geminiRequest);
        } catch (secondaryError) {
          logger.error('Both Gemini request methods failed for text processing', {
            firstError: error.message,
            secondError: secondaryError.message,
            requestId: this.requestCount
          });
          throw secondaryError;
        }
      }
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage && promptLoader.normalizeSkillName(activeSkill) !== 'general'
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM text processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.gemini.fallbackEnabled')) {
        return this.generateFallbackResponse(text, activeSkill);
      }

      throw error;
    }
  }

  async processTextWithSkillStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null) {
    if (!this.isInitialized) {
      throw new Error('Choose your AI provider, endpoint, model and key in Settings.');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      const geminiRequest = this.buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      });

      const finalResponse = programmingLanguage && promptLoader.normalizeSkillName(activeSkill) !== 'general'
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

      logger.logPerformance('LLM text streaming', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true
        }
      };
    } catch (error) {
      logger.warn('Streaming text failed', {
        error: error.message,
        requestId: this.requestCount
      });
      throw error;
    }
  }

  async processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('Choose your AI provider, endpoint, model and key in Settings.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing transcription with intelligent response', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const geminiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const preferAlternative = !!config.get('llm.gemini.enableFallbackMethod');
      let response;
      try {
        if (preferAlternative) {
          logger.debug('Attempting alternative HTTPS method first for transcription processing');
          response = await this.executeAlternativeRequest(geminiRequest);
        } else {
          response = await this.executeRequest(geminiRequest);
        }
      } catch (error) {
        const secondaryLabel = preferAlternative ? 'primary SDK method' : 'alternative HTTPS method';
        logger.warn(`${preferAlternative ? 'Alternative' : 'Primary'} method failed, trying ${secondaryLabel}`, {
          error: error.message,
          requestId: this.requestCount
        });
        const secondaryFn = preferAlternative ? this.executeRequest.bind(this) : this.executeAlternativeRequest.bind(this);
        try {
          response = await secondaryFn(geminiRequest);
        } catch (secondaryError) {
          logger.error('Both Gemini request methods failed for transcription processing', {
            firstError: error.message,
            secondError: secondaryError.message,
            requestId: this.requestCount
          });
          throw secondaryError;
        }
      }
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage && promptLoader.normalizeSkillName(activeSkill) !== 'general'
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM transcription processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM transcription processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.gemini.fallbackEnabled')) {
        return this.generateIntelligentFallbackResponse(text, activeSkill);
      }
      
      throw error;
    }
  }

  /**
   * Normalize all triple-backtick code fences to the selected programming language tag.
   * Does not alter the inner code; only ensures fence language tags are correct.
   */
  enforceProgrammingLanguage(text, programmingLanguage) {
    try {
      if (!text || !programmingLanguage) return text;
      const norm = String(programmingLanguage).toLowerCase();
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
      const fenceTag = fenceTagMap[norm] || norm || 'text';

      // Replace all triple-backtick fences' language token with the selected tag
      const replacedBackticks = text.replace(/```([^\n]*)\n/g, (match, info) => {
        const current = (info || '').trim();
        // If already the desired fenceTag as the first token, keep as is
        if (current.split(/\s+/)[0].toLowerCase() === fenceTag) return match;
        return '```' + fenceTag + '\n';
      });

      // Optionally normalize tildes fences to backticks with correct tag
      const normalizedTildes = replacedBackticks.replace(/~~~([^\n]*)\n/g, () => '```' + fenceTag + '\n');

      return normalizedTildes;
    } catch (_) {
      return text;
    }
  }

  buildGeminiRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    // Check if we have the new conversation history format
    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getConversationHistory(15);
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      return this.buildGeminiRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage);
    }

    // Fallback to old method for compatibility - now with programming language support
    const requestComponents = promptLoader.getRequestComponents(
      activeSkill, 
      text, 
      sessionMemory,
      programmingLanguage
    );

    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Use the skill prompt that already has programming language injected
    if (requestComponents.shouldUseModelMemory && requestComponents.skillPrompt) {
      request.systemInstruction = {
        parts: [{ text: requestComponents.skillPrompt }]
      };
      
      logger.debug('Using language-enhanced system instruction for skill', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: requestComponents.skillPrompt.length,
        requiresProgrammingLanguage: requestComponents.requiresProgrammingLanguage
      });
    }

    request.contents.push({
      role: 'user',
      parts: [{ text: this.formatUserMessage(text, activeSkill) }]
    });

    return request;
  }

  buildGeminiRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Use the skill prompt from context (which may already include programming language)
    if (skillContext.skillPrompt) {
      request.systemInstruction = {
        parts: [{ text: skillContext.skillPrompt }]
      };
      
      logger.debug('Using skill context prompt as system instruction', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: skillContext.skillPrompt.length,
        requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false,
        hasLanguageInjection: programmingLanguage && skillContext.requiresProgrammingLanguage
      });
    }

    // Add conversation history (excluding system messages) with validation
    const conversationContents = conversationHistory
      .filter(event => {
        return event.role !== 'system' && 
               event.content && 
               typeof event.content === 'string' && 
               event.content.trim().length > 0;
      })
      .map(event => {
        const content = event.content.trim();
        return {
          role: event.role === 'model' ? 'model' : 'user',
          parts: [{ text: content }]
        };
      });

    // Add the conversation history
    request.contents.push(...conversationContents);

    // Format and validate the current user input
    const formattedMessage = this.formatUserMessage(text, activeSkill);
    if (!formattedMessage || formattedMessage.trim().length === 0) {
      throw new Error('Failed to format user message or message is empty');
    }

    // Add the current user input
    request.contents.push({
      role: 'user',
      parts: [{ text: formattedMessage }]
    });

    logger.debug('Built Gemini request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalContents: request.contents.length,
      hasSystemInstruction: !!request.systemInstruction,
      requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false
    });

    return request;
  }

  buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    // Validate input text first
    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided to buildIntelligentTranscriptionRequest');
    }

    // Check if we have the new conversation history format
    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getConversationHistory(10);
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      return this.buildIntelligentTranscriptionRequestWithHistory(cleanText, activeSkill, conversationHistory, skillContext, programmingLanguage);
    }

    // Fallback to basic intelligent request
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Add intelligent filtering system instruction
    const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);
    if (!intelligentPrompt) {
      throw new Error('Failed to generate intelligent transcription prompt');
    }

    request.systemInstruction = {
      parts: [{ text: intelligentPrompt }]
    };

    request.contents.push({
      role: 'user',
      parts: [{ text: cleanText }]
    });

    logger.debug('Built basic intelligent transcription request', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      textLength: cleanText.length,
      hasSystemInstruction: !!request.systemInstruction
    });

    return request;
  }

  buildIntelligentTranscriptionRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

  // For chat/transcription messages, DO NOT include the full skill prompt; use only the intelligent filter prompt
  const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);
  request.systemInstruction = { parts: [{ text: intelligentPrompt }] };

    // Add recent conversation history (excluding system messages) with validation
    const conversationContents = conversationHistory
      .filter(event => {
        // Filter out system messages and ensure content exists and is valid
        return event.role !== 'system' && 
               event.content && 
               typeof event.content === 'string' && 
               event.content.trim().length > 0;
      })
      .slice(-8) // Keep last 8 exchanges for context
      .map(event => {
        const content = event.content.trim();
        if (!content) {
          logger.warn('Empty content found in conversation history', { event });
          return null;
        }
        return {
          role: event.role === 'model' ? 'model' : 'user',
          parts: [{ text: content }]
        };
      })
      .filter(content => content !== null); // Remove any null entries

    // Add the conversation history
    request.contents.push(...conversationContents);

    // Validate and add the current transcription
    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided');
    }

    request.contents.push({
      role: 'user',
      parts: [{ text: cleanText }]
    });

    // Ensure we have at least one content item
    if (request.contents.length === 0) {
      throw new Error('No valid content to send to Gemini API');
    }

    logger.debug('Built intelligent transcription request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalContents: request.contents.length,
      hasSkillPrompt: !!skillContext.skillPrompt,
      cleanTextLength: cleanText.length,
      requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false
    });

    return request;
  }

  getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage) {
    return promptLoader.getSkillPrompt('general', programmingLanguage);
  }

  formatUserMessage(text, activeSkill) {
    return text;
  }

  async executeRequest(geminiRequest) {
    const maxRetries = config.get('llm.gemini.maxRetries');
    const timeout = config.get('llm.gemini.timeout');
    const primaryModel = this.model;
    const fallbackModels = config.get('llm.gemini.fallbackModels') || [];
    const modelsToTry = [primaryModel, ...fallbackModels];

    logger.debug('Executing Gemini request', {
      hasModel: !!this.model,
      hasClient: !!this.client,
      requestKeys: Object.keys(geminiRequest),
      timeout,
      maxRetries,
      modelsToTry,
      nodeVersion: process.version,
      platform: process.platform
    });

    let lastError = null;

    for (const modelName of modelsToTry) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
          );

          logger.debug(`Gemini API attempt ${attempt} starting with model ${modelName}`, {
            timestamp: new Date().toISOString(),
            timeout,
            model: modelName
          });

          const requestPromise = this.client.models.generateContent({
            model: modelName,
            contents: geminiRequest.contents,
            config: { ...geminiRequest.generationConfig, systemInstruction: geminiRequest.systemInstruction }
          });
          const result = await Promise.race([requestPromise, timeoutPromise]);

          if (!result) {
            throw new Error('Empty response from Gemini API');
          }

          const { text, finishReason } = this.extractTextFromCandidates(result);

          if (finishReason === 'MAX_TOKENS') {
            logger.warn('Gemini response reached max tokens limit', {
              attempt,
              finishReason,
              model: modelName
            });
          }

          logger.debug('Gemini API request successful', {
            attempt,
            model: modelName,
            responseLength: text.length,
            finishReason
          });

          return text;
        } catch (error) {
          const errorInfo = this.analyzeError(error);
          lastError = error;

          // Enhanced error logging for fetch failures
          if (errorInfo.type === 'NETWORK_ERROR') {
            logger.error('Network error details', {
              attempt,
              model: modelName,
              errorMessage: error.message,
              errorStack: error.stack,
              errorName: error.name,
              nodeEnv: process.env.NODE_ENV,
              electronVersion: process.versions.electron,
              chromeVersion: process.versions.chrome,
              nodeVersion: process.versions.node,
              userAgent: this.getUserAgent()
            });
          }

          logger.warn(`Gemini API attempt ${attempt} failed for model ${modelName}`, {
            error: error.message,
            errorType: errorInfo.type,
            isNetworkError: errorInfo.isNetworkError,
            suggestedAction: errorInfo.suggestedAction,
            remainingAttempts: maxRetries - attempt,
            model: modelName
          });

          // For model-unavailable / overloaded / rate-limit errors, move to
          // the next fallback model immediately instead of burning all retries.
          const isModelUnavailable = errorInfo.type === 'RATE_LIMIT_ERROR' ||
            error.message.includes('503') ||
            error.message.includes('UNAVAILABLE') ||
            error.message.includes('high demand');

          if (isModelUnavailable && modelName !== modelsToTry[modelsToTry.length - 1]) {
            logger.info(`Switching to fallback model after ${modelName} unavailable`, {
              model: modelName,
              error: error.message
            });
            break; // exit retry loop for this model and try next model
          }

          if (attempt === maxRetries) {
            break; // exit retry loop for this model and try next model
          }

          // Use exponential backoff with jitter for network errors
          const baseDelay = errorInfo.isNetworkError ? 2500 : 1500;
          const delay = baseDelay * attempt + Math.random() * 1000;

          logger.debug(`Waiting ${delay}ms before retry ${attempt + 1}`, {
            baseDelay,
            isNetworkError: errorInfo.isNetworkError,
            model: modelName
          });

          await this.delay(delay);
        }
      }
    }

    const finalErrorInfo = this.analyzeError(lastError);
    const finalError = new Error(`Gemini API failed after trying ${modelsToTry.join(', ')}: ${lastError?.message}`);
    finalError.errorAnalysis = finalErrorInfo;
    finalError.originalError = lastError;
    throw finalError;
  }

  /**
   * Streaming sibling of processTranscriptionWithIntelligentResponse. Emits
   * incremental text via onDelta so the UI can render the answer as it is
   * generated (much faster perceived latency). Returns the same
   * {response, metadata} shape. Falls back to the non-streaming path on any
   * streaming failure so reliability is never worse than before.
   */
  async processTranscriptionWithIntelligentResponseStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null) {
    if (!this.isInitialized) {
      throw new Error('Choose your AI provider, endpoint, model and key in Settings.');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      const geminiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      });

      const finalResponse = programmingLanguage && promptLoader.normalizeSkillName(activeSkill) !== 'general'
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

      logger.logPerformance('LLM transcription streaming', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true,
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      logger.warn('Streaming transcription failed', {
        error: error.message,
        requestId: this.requestCount
      });
      // Non-streaming path returns the same shape; the caller renders it as a
      // single final response.
      throw error;
    }
  }

  /** Safely pull the text delta out of a streamed Gemini chunk. */
  _extractChunkText(chunk) {
    try {
      const t = chunk && chunk.text;
      if (typeof t === 'string') {
        return t;
      }
    } catch (_) {
      // `.text` getter can throw on non-text parts; fall through to manual read.
    }
    try {
      const parts = (chunk && chunk.candidates && chunk.candidates[0] &&
        chunk.candidates[0].content && chunk.candidates[0].content.parts) || [];
      return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    } catch (_) {
      return '';
    }
  }

  /**
   * Run one streaming request against the configured Gemini model. Accumulates and returns the full text; invokes onDelta
   * for each chunk.
   */
  async executeStreamingRequest(geminiRequest, onDelta) {
    return ai.generate(this.getProviderConfig(),geminiRequest,onDelta);
  }

  getHttpsAgent() {
    if (!this._httpsAgent) this._httpsAgent=new (require('https').Agent)({keepAlive:true,maxSockets:4});
    return this._httpsAgent;
  }

  getModelGenerationConfig(generationConfig,modelName) {
    const settings={...generationConfig};
    if (modelName==='gemini-3.8-flash') settings.thinkingConfig={thinkingLevel:'low'};
    return settings;
  }

  _streamRequestForModel(request,model,key,onDelta) {
    return ai.generate({provider:'gemini',endpoint:ai.PRESETS.gemini.endpoint,model,key},request,onDelta);
  }

  async performPreflightCheck() {
    // Quick connectivity check
    try {
      const startTime = Date.now();
      await this.testNetworkConnection({ 
        host: 'generativelanguage.googleapis.com', 
        port: 443, 
        name: 'Gemini API Endpoint' 
      });
      const latency = Date.now() - startTime;
      
      logger.debug('Preflight check passed', { latency });
    } catch (error) {
      logger.warn('Preflight check failed', { 
        error: error.message,
        suggestion: 'Network connectivity issue detected before API call'
      });
      // Don't throw here - let the actual API call fail with more detail
    }
  }

  getUserAgent() {
    try {
      // Try to get user agent from Electron if available
      if (typeof navigator !== 'undefined' && navigator.userAgent) {
        return navigator.userAgent;
      }
      return `Node.js/${process.version} (${process.platform}; ${process.arch})`;
    } catch {
      return 'Unknown';
    }
  }

  analyzeError(error) {
    const errorMessage = error.message.toLowerCase();
    
    // Network connectivity errors
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('network error') ||
        errorMessage.includes('enotfound') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('timeout')) {
      return {
        type: 'NETWORK_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check internet connection and firewall settings'
      };
    }
    
    // API key errors
    if (errorMessage.includes('unauthorized') || 
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('forbidden')) {
      return {
        type: 'AUTH_ERROR',
        isNetworkError: false,
        suggestedAction: 'Verify Gemini API key configuration'
      };
    }
    
    // Rate limiting
    if (errorMessage.includes('quota') || 
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests')) {
      return {
        type: 'RATE_LIMIT_ERROR',
        isNetworkError: false,
        suggestedAction: 'Wait before retrying or check API quota'
      };
    }
    
    // Timeout errors
    if (errorMessage.includes('request timeout') || errorMessage.includes('etimedout')) {
      return {
        type: 'TIMEOUT_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check network latency or increase timeout'
      };
    }
    
    return {
      type: 'UNKNOWN_ERROR',
      isNetworkError: false,
      suggestedAction: 'Check logs for more details'
    };
  }

  async checkNetworkConnectivity() {
    const connectivityTests = [
      { host: 'google.com', port: 443, name: 'Google (HTTPS)' },
      { host: 'generativelanguage.googleapis.com', port: 443, name: 'Gemini API Endpoint' }
    ];

    const results = await Promise.allSettled(
      connectivityTests.map(test => this.testNetworkConnection(test))
    );

    const connectivity = {
      timestamp: new Date().toISOString(),
      tests: results.map((result, index) => ({
        ...connectivityTests[index],
        success: result.status === 'fulfilled' && result.value,
        error: result.status === 'rejected' ? result.reason.message : null
      }))
    };

    logger.info('Network connectivity check completed', connectivity);
    return connectivity;
  }

  async testNetworkConnection({ host, port, name }) {
    return new Promise((resolve, reject) => {
      const net = require('net');
      const socket = new net.Socket();
      
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${host}:${port}`));
      }, 5000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection failed to ${host}:${port}: ${error.message}`));
      });

      socket.connect(port, host);
    });
  }

  generateFallbackResponse(text, activeSkill) {
    logger.info('Generating fallback response', { activeSkill });

    const fallbackResponses = {
      'dsa': 'This appears to be a data structures and algorithms problem. Consider breaking it down into smaller components and identifying the appropriate algorithm or data structure to use.',
      'system-design': 'For this system design question, consider scalability, reliability, and the trade-offs between different architectural approaches.',
      'programming': 'This looks like a programming challenge. Focus on understanding the requirements, edge cases, and optimal time/space complexity.',
      'default': 'I can help analyze this content. Please ensure your Gemini API key is properly configured for detailed analysis.'
    };

    const response = fallbackResponses[activeSkill] || fallbackResponses.default;
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true
      }
    };
  }

  generateIntelligentFallbackResponse(text, activeSkill) {
    logger.info('Generating intelligent fallback response for transcription', { activeSkill });

    const response = 'I could not get an AI response. Test your selected AI provider in Settings and try again.';

    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true,
        isTranscriptionResponse: true
      }
    };
  }

  async testConnection() {
    try{return await this.testProviderConnection();}catch(error){return {success:false,error:error.message};}
  }

  /**
   * Translate raw SDK / network errors into something a user can act on.
   */
  _friendlyTestError(error, analysis) {
    const type = analysis?.type;
    const raw = (error?.message || '').toLowerCase();

    if (type === 'NETWORK_ERROR' || raw.includes('fetch failed') || raw.includes('enotfound')) {
      return 'Cannot reach Google servers. Check your internet connection, firewall, or VPN settings.';
    }
    if (type === 'AUTH_ERROR' || raw.includes('api key') || raw.includes('401') || raw.includes('403')) {
      return 'Invalid API key or insufficient permissions. Double-check the key at aistudio.google.com/apikey.';
    }
    if (type === 'RATE_LIMIT_ERROR' || raw.includes('429') || raw.includes('quota')) {
      return 'Rate limit or quota exceeded. Wait a moment or check your Google Cloud billing.';
    }
    if (type === 'TIMEOUT_ERROR') {
      return 'Request timed out. The Google API may be slow or unreachable right now.';
    }
    if (type === 'MODEL_ERROR' || raw.includes('model') || raw.includes('404')) {
      return 'The configured Gemini model is unavailable. Try a different model in Settings.';
    }
    if (raw.includes('503') || raw.includes('unavailable') || raw.includes('high demand')) {
      return 'Gemini is experiencing high demand. Please wait a moment and try again.';
    }
    // Fall back to a stripped-down raw message (no SDK prefix noise)
    return (error?.message || 'Connection failed').replace(/^\[(GoogleGenerativeAI|GoogleGenAI) Error\]:\s*/i, '');
  }

  updateApiKey(newApiKey) {
    if(this._profiles)this.saveProviderConfig({provider:'gemini',...ai.PRESETS.gemini,key:newApiKey});
    else{process.env.GEMINI_API_KEY=newApiKey;this.initializeClient();}
  }

  getStats() {
    return {
      isInitialized: this.isInitialized,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount) * 100 : 0,
      config: config.get('llm.gemini')
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeAlternativeRequest(geminiRequest) {
    const https = require('https');
    const apiKey = config.getApiKey('GEMINI');
    const primaryModel = config.get('llm.gemini.model');
    const fallbackModels = config.get('llm.gemini.fallbackModels') || [];
    const modelsToTry = [primaryModel, ...fallbackModels];

    logger.info('Using alternative HTTPS request method', { modelsToTry });

    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const result = await this._executeAlternativeRequestForModel(geminiRequest, modelName, apiKey);
        return result;
      } catch (error) {
        lastError = error;
        logger.warn(`Alternative HTTPS request failed for model ${modelName}`, {
          error: error.message,
          model: modelName
        });

        const isModelUnavailable = error.message.includes('503') ||
          error.message.includes('UNAVAILABLE') ||
          error.message.includes('high demand');

        if (!isModelUnavailable && modelName === primaryModel) {
          break;
        }
      }
    }

    throw lastError || new Error('Alternative HTTPS request failed for all models');
  }

  async _executeAlternativeRequestForModel(geminiRequest, modelName, apiKey) {
    const https = require('https');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const postData = JSON.stringify(geminiRequest);

    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': this.getUserAgent()
      },
      timeout: config.get('llm.gemini.timeout'),
      agent
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }
            
            const response = JSON.parse(data);
            
            logger.debug('Alternative request response structure', {
              hasResponse: !!response,
              hasCandidates: !!response.candidates,
              candidatesLength: response.candidates?.length,
              responseKeys: Object.keys(response || {}),
              firstCandidateKeys: response.candidates?.[0] ? Object.keys(response.candidates[0]) : []
            });

            const { text, finishReason } = this.extractTextFromCandidates(response);

            if (finishReason === 'MAX_TOKENS') {
              logger.warn('Gemini alternative response reached max tokens limit', {
                finishReason
              });
            }
            
            logger.info('Alternative request successful', {
              responseLength: text.length,
              statusCode: res.statusCode,
              finishReason
            });
            
            resolve(text.trim());
          } catch (parseError) {
            logger.error('Failed to parse alternative response', {
              error: parseError.message,
              rawResponse: data.substring(0, 500),
              statusCode: res.statusCode
            });
            reject(new Error(`Failed to parse response: ${parseError.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`Alternative request failed: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Alternative request timeout'));
      });
      
      req.write(postData);
      req.end();
    });
  }
}

module.exports = new LLMService();