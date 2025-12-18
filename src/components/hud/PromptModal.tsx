import { useState } from 'react'

interface PromptModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (prompt: string) => void
}

export default function PromptModal({ isOpen, onClose, onSubmit }: PromptModalProps) {
  const [prompt, setPrompt] = useState('')

  if (!isOpen) return null

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt)
      setPrompt('')
      onClose()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div 
        style={{
          backgroundColor: '#1a1a1a',
          padding: '24px',
          borderRadius: '12px',
          width: '90%',
          maxWidth: '500px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ 
          margin: '0 0 16px 0', 
          color: '#fff',
          fontSize: '20px',
          fontWeight: '600'
        }}>
          Generate Skybox
        </h2>
        
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Describe the skybox you want to generate..."
          style={{
            width: '100%',
            minHeight: '100px',
            padding: '12px',
            backgroundColor: '#2a2a2a',
            border: '1px solid #404040',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px',
            fontFamily: 'inherit',
            resize: 'vertical',
            marginBottom: '16px'
          }}
          autoFocus
        />
        
        <div style={{ 
          display: 'flex', 
          gap: '12px', 
          justifyContent: 'flex-end' 
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#2a2a2a',
              color: '#fff',
              border: '1px solid #404040',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim()}
            style={{
              padding: '10px 20px',
              backgroundColor: prompt.trim() ? '#4a9eff' : '#2a4a6a',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: prompt.trim() ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  )
}