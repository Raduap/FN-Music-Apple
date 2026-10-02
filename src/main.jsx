import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './motion.css'
import './themes.css'
import { applyMotion } from './motion'
import { applyPalette } from './appearance'

try { applyMotion(JSON.parse(localStorage.getItem('fnm:motion')) || 'on') } catch { applyMotion('on') }
try { applyPalette(JSON.parse(localStorage.getItem('fnm:palette'))) } catch { applyPalette('red') }

createRoot(document.getElementById('root')).render(<App />)
