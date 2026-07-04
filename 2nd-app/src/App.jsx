import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

function App() {
  const [tasks, setTasks] = useState([])
  const [newTask, setNewTask] = useState('')

  useEffect(() => {
    loadTasks()
  }, [])

  async function loadTasks() {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error loading tasks:', error)
      return
    }
    setTasks(data)
  }

  async function addTask(e) {
    e.preventDefault()
    if (!newTask.trim()) return

    const { error } = await supabase
      .from('todos')
      .insert({ task: newTask.trim() })

    if (error) {
      console.error('Error adding task:', error)
      return
    }
    setNewTask('')
    loadTasks()
  }

  async function toggleTask(id, isComplete) {
    const { error } = await supabase
      .from('todos')
      .update({ is_completed: !isComplete })
      .eq('id', id)

    if (error) {
      console.error('Error updating task:', error)
      return
    }
    loadTasks()
  }

  async function deleteTask(id) {
    const { error } = await supabase
      .from('todos')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting task:', error)
      return
    }
    loadTasks()
  }

  return (
    <>
      <header className="hero">
        <h1>My To-Do List</h1>
        <p className="tagline">Tasks are saved in a real database — refresh, and they'll still be here.</p>
      </header>

      <main>
        <section className="section">
          <form className="add-form" onSubmit={addTask}>
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="What do you need to do?"
            />
            <button type="submit">Add</button>
          </form>

          <ul className="task-list">
            {tasks.map((t) => (
              <li key={t.id} className={t.is_completed ? 'complete' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!t.is_completed}
                    onChange={() => toggleTask(t.id, !!t.is_completed)}
                  />
                  <span>{t.task}</span>
                </label>
                <button className="delete-btn" onClick={() => deleteTask(t.id)}>
                  Delete
                </button>
              </li>
            ))}
            {tasks.length === 0 && <p className="empty">No tasks yet — add one above.</p>}
          </ul>
        </section>
      </main>

      <footer>
        <p>2nd-app &middot; React + Supabase</p>
      </footer>
    </>
  )
}

export default App
