// controllers/brandController.js
const db = require('../models');

const formatBrand = (brand) => {
    const json = brand.toJSON();
    return {
        id: json.id,
        name: json.name,
        description: json.description || '',
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.created_at,
        updated_at: json.updated_at,
    };
};

// Get all brands
const getAllBrands = async (req, res) => {
    try {
        const brands = await db.Brand.findAll({
            include: [{
                association: 'creator',
                attributes: ['name'],
                required: false,
            }],
            order: [['name', 'ASC']],
        });

        res.json({
            success: true,
            brands: brands.map(formatBrand),
        });
    } catch (error) {
        console.error('getAllBrands error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create brand
const createBrand = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Brand name is required',
            });
        }

        const brand = await db.Brand.create({
            name: name.trim(),
            description: description?.trim() || '',
            created_by: req.user.id,
        });

        const full = await db.Brand.findByPk(brand.id, {
            include: [{ association: 'creator', attributes: ['name'], required: false }],
        });

        res.status(201).json({
            success: true,
            brand: formatBrand(full),
            message: 'Brand created successfully',
        });
    } catch (error) {
        console.error('createBrand error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update brand
const updateBrand = async (req, res) => {
    try {
        const brand = await db.Brand.findByPk(req.params.id);

        if (!brand) {
            return res.status(404).json({ success: false, message: 'Brand not found' });
        }

        const { name, description } = req.body;
        const updateData = {};

        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();

        await brand.update(updateData);

        const full = await db.Brand.findByPk(brand.id, {
            include: [{ association: 'creator', attributes: ['name'], required: false }],
        });

        res.json({
            success: true,
            brand: formatBrand(full),
            message: 'Brand updated successfully',
        });
    } catch (error) {
        console.error('updateBrand error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delete brand
const deleteBrand = async (req, res) => {
    try {
        const brand = await db.Brand.findByPk(req.params.id);

        if (!brand) {
            return res.status(404).json({ success: false, message: 'Brand not found' });
        }

        await brand.destroy();

        res.json({ success: true, message: 'Brand deleted successfully' });
    } catch (error) {
        console.error('deleteBrand error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllBrands,
    createBrand,
    updateBrand,
    deleteBrand,
};