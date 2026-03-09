import express from "express"
import Groq from "groq-sdk"
import fetch from "node-fetch"
import dotenv from "dotenv"

dotenv.config()

const app = express()
const PORT = 5000

app.use(express.json())

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
})

const getRepoInfo = (url) => {
  const cleanUrl = url.trim().replace(/\/+$/, "")
  const parts = cleanUrl.split("github.com/")[1].split("/")
  return {
    owner: parts[0],
    repo: parts[1]
  }
}

const allowedExtensions = [
  ".js",".jsx",".ts",".tsx",".html",".css",".scss",".json",".md",".txt",".py",".java",".c",".cpp",".cs",".php",".rb",".go",".rs",".swift",".kt",".sql",".xml",".yml",".yaml"
]

const ignoredFolders = [
  "node_modules",".git","dist","build",".next","coverage","out","vendor"
]

const isAllowedFile = (name) => {
  return allowedExtensions.some(ext => name.toLowerCase().endsWith(ext))
}

const readGithubRepo = async (githubLink) => {

  const { owner, repo } = getRepoInfo(githubLink)

  let projectCode = ""
  let filesRead = 0
  const maxFiles = 50
  const maxCharsPerFile = 50000

  const readFolder = async (apiUrl) => {

    if (filesRead >= maxFiles) return

    const res = await fetch(apiUrl,{headers:{ "User-Agent":"node"}})

    const items = await res.json()

    for (const item of items) {

      if (filesRead >= maxFiles) break

      if (item.type === "dir") {
        if (!ignoredFolders.includes(item.name)) {
          await readFolder(item.url)
        }
      }

      if (item.type === "file" && isAllowedFile(item.name)) {

        const fileRes = await fetch(item.download_url,{headers:{ "User-Agent":"node"}})

        let content = await fileRes.text()

        content = content.slice(0,maxCharsPerFile)

        projectCode += `\nFile:${item.path}\n${content}\n`

        filesRead++

      }

    }

  }

  const rootApi = `https://api.github.com/repos/${owner}/${repo}/contents`

  await readFolder(rootApi)

  return {
    projectCode,
    filesRead
  }

}

app.get("/",(req,res)=>{
  res.send({msg:"Root Route"})
})

app.post("/api/chatai",async(req,res)=>{

  try{

    const { message } = req.body
    if(!message.includes("github.com")){
      return res.status(400).json({msg:"Invalid GitHub link"})
    }
    const { projectCode, filesRead } = await readGithubRepo(message)

    const response = await groq.chat.completions.create({
      model:"llama-3.1-8b-instant",
      temperature:0,
      max_tokens:20,
      messages:[
        {
          role:"system",
          content:"You are a hackathon judge. Return only a number between 0 and 100."
        },
        {
          role:"user",
          content:`Evaluate this project and return only score number.\n${projectCode}`
        }
      ]
    })

    const aiReply = response.choices[0].message.content

    let score = null

    const numbers = aiReply.match(/\d+/g)

    if(numbers && numbers.length > 0){
      score = parseInt(numbers[0])
    }

    if(score === null){
      score = Math.floor(Math.random()*30)+60
    }

    res.json({
      filesAnalyzed: filesRead,
      score: score
    })

  }catch(err){

    res.status(500).send({msg:err.message})

  }

})

app.listen(PORT,()=>{
  console.log(`App is running on Port: ${PORT}`)
})