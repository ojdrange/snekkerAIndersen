
import { GoogleGenAI, Type } from "@google/genai";
import { AIResponse, UserInputs, DesignProposal } from "./types";

const getApiKey = () => {
  const key = process.env.API_KEY;
  if (!key || key === 'undefined') {
    throw new Error("API-nøkkel mangler. Vennligst sjekk Environment Variables i Vercel.");
  }
  return key;
};

const PROPOSAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    style_package: { type: Type.STRING, enum: ['Modern Minimal', 'Warm Nordic', 'Clean Functional'] },
    carcass: {
      type: Type.OBJECT,
      properties: {
        material: { type: Type.STRING },
        color: { type: Type.STRING, enum: ['white', 'black'] }
      },
      required: ['material', 'color']
    },
    fronts: {
      type: Type.OBJECT,
      properties: {
        material: { type: Type.STRING, enum: ['painted_mdf', 'oak_veneer', 'ash_veneer'] },
        finish: { type: Type.STRING },
        color: { type: Type.STRING }
      },
      required: ['material', 'finish', 'color']
    },
    handle_solution: { type: Type.STRING, enum: ['push_to_open', 'integrated_grip'] },
    lighting: {
      type: Type.OBJECT,
      properties: {
        included: { type: Type.BOOLEAN },
        type: { type: Type.STRING, enum: ['integrated_led', 'none'] }
      },
      required: ['included', 'type']
    },
    dimensions_mm: {
      type: Type.OBJECT,
      properties: {
        width: { type: Type.STRING },
        height: { type: Type.STRING },
        depth: { type: Type.STRING }
      },
      required: ['width', 'height', 'depth']
    },
    internal_layout: { type: Type.ARRAY, items: { type: Type.STRING } },
    visual_notes: { type: Type.STRING },
    production_notes: { type: Type.STRING }
  },
  required: ['id', 'style_package', 'carcass', 'fronts', 'handle_solution', 'lighting', 'dimensions_mm', 'internal_layout', 'visual_notes', 'production_notes']
};

const parseImageData = (dataUrl: string) => {
  const parts = dataUrl.split(',');
  if (parts.length < 2) throw new Error("Ugyldig bildeformat");
  const mimeType = parts[0].split(':')[1].split(';')[0];
  const base64Data = parts[1];
  return { mimeType, base64Data };
};

export const generateFurnitureProposals = async (inputs: UserInputs): Promise<AIResponse> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const systemInstruction = `
    Du er Snekker AIndersen, en ekspert på plasstilpassede møbler. 
    Ditt mandat er å lage JSON-forslag som er 100% i tråd med brukerens beskrivelse av farger og materialer.
    
    KRITISK REGEL FOR DIMENSJONER: 
    Brukeren har satt et "Startpunkt" og eventuelt "Hindringer" (røde kryss). 
    Møbelet skal starte ved Startpunktet og stoppe FØR det treffer en Hindring.
    Hvis brukerens ønskede bredde (${inputs.width}mm) er for stor til å passe mellom Startpunktet og Hindringen, må du JUSTERE NED bredden i JSON-forslaget slik at det fysisk passer i rommet.
  `;

  const exclusionsText = inputs.exclusion_points.length > 0 
    ? `HINDRINGER (Møbelet må avsluttes før disse punktene): ${inputs.exclusion_points.map(p => `x:${p.x.toFixed(1)}%, y:${p.y.toFixed(1)}%`).join(', ')}.`
    : '';

  const prompt = `Lag 6 unike designforslag for en ${inputs.productType}.
    BRUKERENS STIL-BESKRIVELSE: "${inputs.description}"
    ØNSKEDE MÅL: Bredde ${inputs.width}mm, Høyde ${inputs.height}mm.
    STARTPUNKT: x:${inputs.placement_point?.x.toFixed(1)}%, y:${inputs.placement_point?.y.toFixed(1)}%.
    ${exclusionsText}
    
    Viktig: Hvis det er en hindring nær startpunktet, sørg for at 'dimensions_mm.width' i JSON reflekterer den faktiske plassen som er tilgjengelig.`;

  const { mimeType, base64Data } = parseImageData(inputs.image!);

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          room_analysis: {
            type: Type.OBJECT,
            properties: {
              room_type: { type: Type.STRING },
              style_impression: { type: Type.STRING },
              floor_tone: { type: Type.STRING },
              wall_tone: { type: Type.STRING },
              constraints: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['room_type', 'style_impression', 'floor_tone', 'wall_tone', 'constraints']
          },
          design_proposals: { type: Type.ARRAY, items: PROPOSAL_SCHEMA }
        },
        required: ['room_analysis', 'design_proposals']
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const visualizeProposal = async (baseImage: string, proposal: DesignProposal, inputs: UserInputs, refinementComment?: string): Promise<string | undefined> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  
  const xPos = inputs.placement_point?.x || 50;
  const yPos = inputs.placement_point?.y || 50;
  const { mimeType, base64Data } = parseImageData(baseImage);
  
  const exclusionsText = inputs.exclusion_points.length > 0 
    ? `HINDRINGER: Møbelet SKAL stoppe og ha en sideplate FØR det treffer disse punktene: ${inputs.exclusion_points.map(p => `x=${p.x.toFixed(1)}%, y=${p.y.toFixed(1)}%`).join(', ')}.`
    : '';

  const prompt = `
    OPPGAVE: Lag en ren fotorealistisk visualisering av et nytt møbel i rommet.
    
    PLASSERING (VIKTIG):
    - Markeringspunktet (x=${xPos.toFixed(1)}%, y=${yPos.toFixed(1)}%) er der møbelet skal starte eller være forankret. 
    - Analyser bildet: Hvis markeringspunktet er i et hjørne eller mot en vegg, skal møbelet følge den veggen.
    - Sørg for at møbelet vender UT mot rommet og ikke "motsatt" vei av det naturlige.
    - Møbelet skal stå flatt på gulvet.
    
    DESIGN:
    - Type: ${inputs.productType}
    - Bredde: ${proposal.dimensions_mm.width}mm
    - Materiale/Farge: ${proposal.fronts.material}, farge "${proposal.fronts.color}".
    - Sider: ${proposal.carcass.color === 'white' ? 'Hvite' : 'Svarte'}.
    - Håndtak: ${proposal.handle_solution === 'push_to_open' ? 'Ingen synlige håndtak' : 'Integrert grep'}.
    
    ${exclusionsText}
    
    !!! FORBUD (SØRG FOR AT DISSE IKKE FINNES I BILDET) !!!
    1. INGEN MÅLELINJER: Ikke tegn piler, dimensjonslinjer, hvite streker eller tekniske tegninger.
    2. INGEN TEKST: Absolutt ingen ord, bokstaver eller tall (ingen "2000mm", ingen "side", ingenting).
    3. INGEN MARKERINGER: Ikke tegn kryss, sirkler eller andre grafiske overlegg.
    4. KUN FOTOREALISME: Bildet skal se ut som et helt vanlig fotografi tatt etter at møbelet ble montert.
    
    ${refinementComment ? `BRUKERENS KOMMENTAR: ${refinementComment}` : ''}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { inlineData: { data: base64Data, mimeType } },
        { text: prompt },
      ],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
  }
  return undefined;
};

export const refineSpecificProposal = async (original: DesignProposal, comment: string, inputs: UserInputs): Promise<DesignProposal> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const { visual_image, ...currentProposalData } = original;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [{
        text: `Oppdater dette møbelet. 
               Endring: "${comment}"
               Gjeldende design: ${JSON.stringify(currentProposalData)}`
      }]
    },
    config: {
      systemInstruction: "Du er Snekker AIndersen. Returner kun oppdatert JSON-data.",
      responseMimeType: "application/json",
      responseSchema: PROPOSAL_SCHEMA
    }
  });

  return JSON.parse(response.text || '{}');
};
