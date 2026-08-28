import React from 'react'
import ReactDOM from 'react-dom/client'
import '../../src/styles.css'
import { WorkspaceApp } from './WorkspaceApp'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceApp />
  </React.StrictMode>,
)
