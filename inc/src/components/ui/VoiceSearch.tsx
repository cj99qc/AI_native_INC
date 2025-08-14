'use client'

import { useState, useEffect } from 'react'
import { Mic, MicOff, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { motion, AnimatePresence } from 'framer-motion'

interface VoiceSearchProps {
  onSearch: (query: string) => void
  placeholder?: string
  className?: string
}

export function VoiceSearch({ onSearch, placeholder = "Search for products, stores, services...", className }: VoiceSearchProps) {
  const [isListening, setIsListening] = useState(false)
  const [query, setQuery] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recognition, setRecognition] = useState<any | null>(null)
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    // Check if Web Speech API is supported
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognitionInstance = new SpeechRecognition()
      
      recognitionInstance.continuous = false
      recognitionInstance.interimResults = true
      recognitionInstance.lang = 'en-US'

      recognitionInstance.onstart = () => {
        setIsListening(true)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognitionInstance.onresult = (event: any) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        setQuery(transcript)
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
  }, [])

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

  const handleSearch = () => {
    if (query.trim()) {
      onSearch(query.trim())
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className={`relative ${className}`}>
      <div className="relative flex items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            className="pl-10 pr-20 py-3 text-base rounded-full border-2 border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
          
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
            {isSupported && (
              <AnimatePresence>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Button
                    size="sm"
                    variant={isListening ? "destructive" : "outline"}
                    onClick={isListening ? stopListening : startListening}
                    className={`h-8 w-8 p-0 rounded-full border-2 ${
                      isListening
                        ? 'bg-red-500 border-red-500 hover:bg-red-600'
                        : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'
                    }`}
                  >
                    {isListening ? (
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1 }}
                      >
                        <MicOff className="h-3 w-3" />
                      </motion.div>
                    ) : (
                      <Mic className="h-3 w-3" />
                    )}
                  </Button>
                </motion.div>
              </AnimatePresence>
            )}
            
            <Button
              size="sm"
              onClick={handleSearch}
              disabled={!query.trim()}
              className="h-8 px-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Search
            </Button>
          </div>
        </div>
      </div>

      {/* Voice recognition indicator */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute top-full left-0 right-0 mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-2"
          >
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="h-2 w-2 bg-red-500 rounded-full"
            />
            <span className="text-sm text-blue-700 dark:text-blue-300">
              Listening... Speak now
            </span>
            <div className="flex gap-1 ml-auto">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ 
                    height: [4, 12, 4],
                    backgroundColor: ["#3b82f6", "#ef4444", "#3b82f6"]
                  }}
                  transition={{ 
                    repeat: Infinity, 
                    duration: 0.6,
                    delay: i * 0.1
                  }}
                  className="w-1 bg-blue-500 rounded-full"
                  style={{ height: 4 }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search suggestions */}
      {query && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-10"
        >
          <div className="p-2">
            <button
              onClick={handleSearch}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center gap-2"
            >
              <Search className="h-4 w-4 text-gray-400" />
              <span className="text-sm">Search for &quot;{query}&quot;</span>
            </button>
          </div>
        </motion.div>
      )}
    </div>
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