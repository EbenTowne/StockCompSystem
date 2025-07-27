// frontend/src/components/ActivityFeed.tsx
import React from 'react'

export interface ActivityItem {
  id: number
  type: string        // e.g. "LOGIN", "PASSWORD_RESET", "INVITE_SENT"
  description: string // human-readable
  time: string        // ISO string
}

export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map(i => (
        <li key={i.id} className="flex justify-between bg-gray-50 p-3 rounded">
          <div>
            <span className="font-medium">{i.type.replace(/_/g,' ')}</span>
            <p className="text-gray-600">{i.description}</p>
          </div>
          <time className="text-sm text-gray-500">
            {new Date(i.time).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  )
}
