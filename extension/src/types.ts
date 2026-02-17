/**
 * Message types for communication between extension components
 */

// Re-export RecordingState from storage module
export type { RecordingState } from './lib/storage';

export interface BaseMessage {
  type: string;
  timestamp: number;
}

// Popup -> Background messages (commands)
export interface StartRecordingMessage extends BaseMessage {
  type: 'START_RECORDING';
  tabId: number;
  url: string;
}

export interface StopRecordingMessage extends BaseMessage {
  type: 'STOP_RECORDING';
}

export interface GetRecordingStateMessage extends BaseMessage {
  type: 'GET_RECORDING_STATE';
}

// Background -> Content messages
export interface StartRecordingTabMessage extends BaseMessage {
  type: 'START_RECORDING_TAB';
  sessionId: string;
}

export interface StopRecordingTabMessage extends BaseMessage {
  type: 'STOP_RECORDING_TAB';
}

// Content -> Background messages
export interface StepCapturedMessage extends BaseMessage {
  type: 'STEP_CAPTURED';
  sessionId: string;
  step: RecordedStep;
}

// Re-export RecordedStep from steps module
export type { RecordedStep } from './lib/steps';
import type { RecordedStep } from './lib/steps';

// Legacy messages (kept for backward compatibility)
export interface RecordingStartedMessage extends BaseMessage {
  type: 'RECORDING_STARTED';
  sessionId: string;
}

export interface RecordingStoppedMessage extends BaseMessage {
  type: 'RECORDING_STOPPED';
  sessionId: string;
}

export interface EventCapturedMessage extends BaseMessage {
  type: 'EVENT_CAPTURED';
  sessionId: string;
  event: CapturedEvent;
}

export interface CapturedEvent {
  eventType: string;
  selector?: string;
  value?: unknown;
  timestamp: number;
}

// Response types
export interface StartRecordingResponse {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface StopRecordingResponse {
  success: boolean;
  error?: string;
}

export interface GetRecordingStateResponse {
  success: boolean;
  state?: import('./lib/storage').RecordingState;
  error?: string;
}

// Step management messages
export interface DeleteStepMessage extends BaseMessage {
  type: 'DELETE_STEP';
  index: number;
}

export interface ClearRecordingMessage extends BaseMessage {
  type: 'CLEAR_RECORDING';
}

export interface GetRecordedStepsMessage extends BaseMessage {
  type: 'GET_RECORDED_STEPS';
}

export interface ConsoleLogMessage extends BaseMessage {
  type: 'CONSOLE_LOG';
  level: string;
  args: string[];
}

export interface WalletStateDetectedMessage extends BaseMessage {
  type: 'WALLET_STATE_DETECTED';
  sessionId: string;
  walletConnected: boolean;
  walletAddress: string | null;
}

export interface CapturePageStateMessage extends BaseMessage {
  type: 'CAPTURE_PAGE_STATE';
}

export interface CaptureSuccessStateMessage extends BaseMessage {
  type: 'CAPTURE_SUCCESS_STATE';
}

export interface GetSuccessStateMessage extends BaseMessage {
  type: 'GET_SUCCESS_STATE';
}

export type ExtensionMessage =
  | StartRecordingMessage
  | StopRecordingMessage
  | GetRecordingStateMessage
  | StartRecordingTabMessage
  | StopRecordingTabMessage
  | StepCapturedMessage
  | RecordingStartedMessage
  | RecordingStoppedMessage
  | EventCapturedMessage
  | DeleteStepMessage
  | ClearRecordingMessage
  | GetRecordedStepsMessage
  | ConsoleLogMessage
  | WalletStateDetectedMessage
  | CapturePageStateMessage
  | CaptureSuccessStateMessage
  | GetSuccessStateMessage;

export type ExtensionResponse =
  | StartRecordingResponse
  | StopRecordingResponse
  | GetRecordingStateResponse
  | { success: boolean };
