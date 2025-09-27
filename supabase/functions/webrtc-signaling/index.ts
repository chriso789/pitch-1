import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Store active connections
const connections = new Map<string, WebSocket>();
const callSessions = new Map<string, {
  caller: string;
  callee: string;
  status: 'ringing' | 'connected' | 'ended';
  startTime: Date;
}>();

serve(async (req) => {
  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const sessionId = url.searchParams.get("sessionId");

  if (!userId) {
    return new Response("Missing userId", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.log(`WebRTC signaling connected for user ${userId}`);
    connections.set(userId, socket);
  };

  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log(`Received message type: ${message.type} from ${userId}`);

      switch (message.type) {
        case 'call-offer':
          await handleCallOffer(message, userId);
          break;
        case 'call-answer':
          await handleCallAnswer(message, userId);
          break;
        case 'ice-candidate':
          await handleIceCandidate(message, userId);
          break;
        case 'end-call':
          await handleEndCall(message, userId);
          break;
        case 'call-status':
          await handleCallStatus(message, userId);
          break;
        default:
          console.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      socket.send(JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  };

  socket.onclose = () => {
    console.log(`WebRTC signaling disconnected for user ${userId}`);
    connections.delete(userId);
    
    // Clean up any active sessions involving this user
    for (const [sessionId, session] of callSessions.entries()) {
      if (session.caller === userId || session.callee === userId) {
        session.status = 'ended';
        notifySessionUpdate(sessionId, session);
      }
    }
  };

  return response;
});

async function handleCallOffer(message: any, fromUserId: string) {
  const { to, offer, sessionId } = message;
  
  // Create call session
  callSessions.set(sessionId, {
    caller: fromUserId,
    callee: to,
    status: 'ringing',
    startTime: new Date()
  });

  // Forward offer to callee
  const calleeSocket = connections.get(to);
  if (calleeSocket && calleeSocket.readyState === WebSocket.OPEN) {
    calleeSocket.send(JSON.stringify({
      type: 'incoming-call',
      from: fromUserId,
      offer,
      sessionId
    }));
  } else {
    // Callee not available, trigger call forwarding
    await handleCallForwarding(to, fromUserId, sessionId);
  }
}

async function handleCallAnswer(message: any, fromUserId: string) {
  const { to, answer, sessionId } = message;
  
  // Update session status
  const session = callSessions.get(sessionId);
  if (session) {
    session.status = 'connected';
    notifySessionUpdate(sessionId, session);
  }

  // Forward answer to caller
  const callerSocket = connections.get(to);
  if (callerSocket && callerSocket.readyState === WebSocket.OPEN) {
    callerSocket.send(JSON.stringify({
      type: 'call-answered',
      from: fromUserId,
      answer,
      sessionId
    }));
  }
}

async function handleIceCandidate(message: any, fromUserId: string) {
  const { to, candidate, sessionId } = message;
  
  const targetSocket = connections.get(to);
  if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
    targetSocket.send(JSON.stringify({
      type: 'ice-candidate',
      from: fromUserId,
      candidate,
      sessionId
    }));
  }
}

async function handleEndCall(message: any, fromUserId: string) {
  const { sessionId } = message;
  
  const session = callSessions.get(sessionId);
  if (session) {
    session.status = 'ended';
    
    // Notify both parties
    const otherUserId = session.caller === fromUserId ? session.callee : session.caller;
    const otherSocket = connections.get(otherUserId);
    
    if (otherSocket && otherSocket.readyState === WebSocket.OPEN) {
      otherSocket.send(JSON.stringify({
        type: 'call-ended',
        sessionId,
        endedBy: fromUserId
      }));
    }
    
    notifySessionUpdate(sessionId, session);
    callSessions.delete(sessionId);
  }
}

async function handleCallStatus(message: any, fromUserId: string) {
  const { sessionId, status } = message;
  
  const session = callSessions.get(sessionId);
  if (session) {
    session.status = status;
    notifySessionUpdate(sessionId, session);
  }
}

async function handleCallForwarding(originalCallee: string, caller: string, sessionId: string) {
  console.log(`Initiating call forwarding for ${originalCallee}`);
  
  // Here we would implement call forwarding logic
  // For now, trigger answering service
  await triggerAnsweringService(caller, sessionId);
}

async function triggerAnsweringService(caller: string, sessionId: string) {
  console.log(`Triggering answering service for call from ${caller}`);
  
  // Update session to indicate answering service is handling
  const session = callSessions.get(sessionId);
  if (session) {
    session.callee = 'answering-service';
    session.status = 'connected';
    notifySessionUpdate(sessionId, session);
  }
  
  // Send answering service response to caller
  const callerSocket = connections.get(caller);
  if (callerSocket && callerSocket.readyState === WebSocket.OPEN) {
    callerSocket.send(JSON.stringify({
      type: 'answering-service-active',
      sessionId,
      message: 'Thank you for calling. Please hold while we connect you to an agent.'
    }));
  }
}

function notifySessionUpdate(sessionId: string, session: any) {
  // Broadcast session update to monitoring systems
  console.log(`Session ${sessionId} updated:`, session);
}