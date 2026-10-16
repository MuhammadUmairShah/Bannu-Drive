import express from "express";
import { chatWithAI } from "./ai.controller.js";

const route = express.Router();

route.post("/chat", chatWithAI);

export default route;