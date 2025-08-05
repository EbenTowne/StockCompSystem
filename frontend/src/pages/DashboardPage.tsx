// frontend/src/pages/DashboardPage.tsx
import React, { useEffect, useState } from 'react'
import axios from 'axios'
import SummaryCards, { Summary } from '../components/SummaryCards'
import VestingChart, { VestingPoint } from '../components/VestingChart'
import ActivityFeed, { ActivityItem } from '../components/ActivityFeed'

const API = import.meta.env.VITE_API_URL

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [timeline, setTimeline] = useState<VestingPoint[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])

  useEffect(() => {
    // fetch your three endpoints
    axios.get<Summary>(`${API}/dashboard/summary/`)
      .then(r => setSummary(r.data))
      .catch(() => {/* handle error */})

    axios.get<VestingPoint[]>(`${API}/dashboard/timeline/`)
      .then(r => setTimeline(r.data))
      .catch(() => {/* handle error */})

    axios.get<ActivityItem[]>(`${API}/dashboard/activity/`)
      .then(r => setActivity(r.data))
      .catch(() => {/* handle error */})
  }, [])

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      {summary && <SummaryCards summary={summary} />}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-xl mb-2">Vesting Timeline</h2>
        <VestingChart data={timeline} />
      </div>
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-xl mb-2">Recent Activity</h2>
        <ActivityFeed items={activity} />
      </div>
    </div>
  )
}
