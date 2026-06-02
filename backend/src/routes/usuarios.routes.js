const express = require("express");
const router = express.Router();

const usuariosConfigController = require("../controllers/usuariosConfigController");
const { autenticar } = require("../middlewares/authMiddleware");

router.put("/configurar", autenticar, usuariosConfigController.configurar);

module.exports = router;
