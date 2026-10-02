import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './motion.css'
import { applyMotion } from './motion'

try { applyMotion(JSON.parse(localStorage.getItem('fnm:motion')) || 'on') } catch { applyMotion('on') }

createRoot(document.getElementById('root')).render(<App />)
