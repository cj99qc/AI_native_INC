'use client'

import { useState, useEffect } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'

interface VoiceButtonProps {
  onTranscript: (transcript: string) => void
  className?: string
}

export function VoiceButton({ onTranscript, className }: VoiceButtonProps) {
  const [isListening, setIsListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recognition, setRecognition] = useState<any | null>(null)
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    // Check if Web Speech API is supported
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognitionInstance = new SpeechRecognition()
      
      recognitionInstance.continuous = false
      recognitionInstance.interimResults = false
      recognitionInstance.lang = 'en-US'

      recognitionInstance.onstart = () => {
        setIsListening(true)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognitionInstance.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript
        onTranscript(transcript)
      }

      recognitionInstance.onend = () => {
        setIsListening(false)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognitionInstance.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
      }

      setRecognition(recognitionInstance)
      setIsSupported(true)
    }
  }, [onTranscript])

  const startListening = () => {
    if (recognition) {
      recognition.start()
    }
  }

  const stopListening = () => {
    if (recognition) {
      recognition.stop()
    }
  }

  if (!isSupported) {
    return null
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={isListening ? stopListening : startListening}
      className={`h-8 w-8 p-0 ${className}`}
      title={isListening ? 'Stop listening' : 'Start voice search'}
    >
      {isListening ? (
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1 }}
        >
          <MicOff className="h-4 w-4 text-red-500" />
        </motion.div>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  )
}

// Type declarations for Web Speech API
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any
  }
}